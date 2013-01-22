// Minecraft stuff
// Daniel Stephens (iriel@iriel.org), Jan 2013

var fs = require('fs');
var util = require('util');
var tagio = require('./minecraft-tagio');
var blockfile = require('./blockfile');
var zlib = require('zlib');

// Region IO Experimeents

const BLOCK_SIZE = 4096;
const BLOCK_CHUNKS = BLOCK_SIZE / 4;
const CHUNK_EDGE_SIZE = 32;

const ENCODING_GZIP = 1;
const ENCODING_DEFLATE = 2;

// ---------------------------------------------------------------------------

var internal = require('./minecraft-internal');
const notifyPending = internal.notifyPending;

const Chunk = require('./minecraft-chunk').Chunk;

// ---------------------------------------------------------------------------

var RegionIndex = function(buf, serial) {
    Object.defineProperty(this, '_buf', 
			       { enumerable : false, value: buf,  writable: false });
    Object.defineProperty(this, 'serial', 
			       { enumerable : true, value: serial,  writable: false });
}

RegionIndex.prototype.getBufferCopy = function() {
    var buf = this._buf;
    var copy = new Buffer(buf.length);
    buf.copy(copy);
    return copy;
}

RegionIndex.prototype.toString = function() {
    var result = "RegionIndex{" + this.serial + "}:";
    var buf = this._buf;
    for (var i = 0; i < BLOCK_CHUNKS; ++i) {
	var entry = buf.readUInt32BE(i * 4);
	var entryTime = buf.readUInt32BE(i * 4 + BLOCK_SIZE);
	var entryOffset = (entry >>> 8);
	var entryBlocks = (entry & 0x0ff);
	if (entry == 0 && entryTime == 0) { continue; }
	var x = i % CHUNK_EDGE_SIZE;
	var z = (i - x) / CHUNK_EDGE_SIZE;
	result = result + "\n  [" + x + "," + z + "]\t"
	    + entryOffset + "\t" + entryBlocks + "\t"
	    + new Date(entryTime * 1000);
    }
    return result;
}

RegionIndex.prototype.hasChunk = function(x, z) {
    var idx;
    if (z == null) {
	idx = x;
    } else {
	idx = x + z * CHUNK_EDGE_SIZE;
    }
    var index = this._buf;
    var entry = index.readUInt32BE(idx * 4);
    return (entry != 0); 
}

RegionIndex.prototype.get = function(x, z) {
    var idx;
    if (z == null) {
	idx = x;
    } else {
	idx = x + z * CHUNK_EDGE_SIZE;
    }
    var index = this._buf;
    var entry = index.readUInt32BE(idx * 4);
    var entryTime = index.readUInt32BE(idx * 4 + BLOCK_SIZE);
    if (entry == 0) {
	return [ entryTime ];
    } else {
	var entryOffset = (entry >>> 8);
	var entryBlocks = (entry & 0x0ff);
	return [ entryTime, entryOffset, entryBlocks ];
    }
}

// ---------------------------------------------------------------------------

var DEFAULT_REGION_OPTIONS = {
    sync : false,
    writable : false,
    indexCache : true,
    indexCheck : false
};

var createOptions = function(defaults, opts) {
    var result = {};
    var keys = Object.keys(defaults);
    for (var i = 0; i < keys.length; ++i) {
	var k = keys[i];
	var d = defaults[k];
	var o = (opts == null) ? null : opts[k];
	if (o != null) {
	    result[k] = o;
	} else {
	    result[k] = d;
	}
    }
    return result;
}

var Region = function(path, x, z, opts) {
    var options = createOptions(DEFAULT_REGION_OPTIONS, opts);
    this._options = options;
    this.path = path;
    this._indexSerial = -1;
    this._changeSerial = -1;
    this.writable = Boolean(options.writable);
    this.sync = Boolean(options.sync);
    this.indexCache = Boolean(options.indexCache);
    this.indexCheck = Boolean(options.indexCheck);
    this.xSize = CHUNK_EDGE_SIZE;
    this.zSize = CHUNK_EDGE_SIZE;
    this.regionX = x; // Region within dimension
    this.regionZ = z; // Region within dimension
}

Region.prototype.open = function(callback) {
    if (this._blockfile != null) {
	// Already open!
	callback(null, this);
	return;
    }
    if (this._openPending) {
	this._openPending.push(callback);
	return;
    }
    this._openPending = [ callback ];

    var that = this;

    var openCallback = function(err, fd) {
	if (err) {
	    notifyPending(that, '_openPending', err);
	} else {
	    // Pass the index serial to invalidate cache assumptions
	    var newSerial = that._indexSerial;
	    if (newSerial <= that._changeSerial) {
		newSerial = that._changeSerial;
	    }
	    // TODO make this more definite
	    newSerial += 1000;
	    that._blockfile = new blockfile.BlockFile(fd, {
		blockSize : BLOCK_SIZE,
		writable : that.writable,
		initSerial : newSerial
	    });
	    notifyPending(that, '_openPending', null, that);
	}
    }

    try {
	var flags = this.sync ? "rs" : "r";
	if (this.writable) { flags = flags + "+"; }
	fs.open(this.path, flags, openCallback);
    } catch (e) {
	notifyPending(this, '_openPending', e);
    }
}

var loadIndexCallback = function(that, err, buf, serial, fileSerial) {
    if (err) {
	notifyPending(that, '_indexLoading', err);
	return;
    }
    if (buf != null 
	&& serial >= that._changeSerial
	&& serial >= that._indexSerial) {
	var index = new RegionIndex(buf, serial);
	// The result IS useful
	if (that.indexCache) {
	    that._index = index;
	    that._indexSerial = serial;
	}
	notifyPending(that, '_indexLoading', null, index, fileSerial);
	return;
    } else if (buf == null 
	       && that.indexCache && serial == that._indexSerial
	       && serial <= that._changeSerial) {
	var index = that._index;
	if (index != null) {
	    notifyPending(that, '_indexLoading', null, index, fileSerial);
	    return;
	}
    }
    // Otherwise need to (re) fetch
    var file = that._blockfile;
    if (file == null) {
	that.open(function(err, self) {
	    loadIndexCallback(that, null, err);
	});
	return;
    }
    var needSerial = (that.indexCache && that.__index != null) ? that._indexSerial : null;
    /* util.log("Requesting index; needSerial " + needSerial + " buf " + Boolean(buf) + " serial " + serial);; */
    file.readIfChanged(0, 2, needSerial,
		       function(err, buf, newSerial, fileSerial) {
			   loadIndexCallback(that, err, buf,
					     newSerial, fileSerial);
		       });
}

Region.prototype.getIndex = function(callback) {
    if (this._indexLoading) {
	this._indexLoading.push(callback);
	return;
    }

    this._indexLoading = [ callback ];
    loadIndexCallback(this);
}

Region.prototype.getIndexEntry = function(x, z, callback) {
    if (callback == null) {
	callback = z;
	z = null;
    }
    if (z == null) {
	x = Math.floor(Number(x));
	if (x < 0 || x >= BLOCK_CHUNKS) {
	    callback(new RangeError("Block index '" + x + "' out of range"));
	    return;
	}
    } else {
	x = Number(x);
	x = (x == null) ? -1 : Math.floor(x);
	if (x < 0 || x >= CHUNK_EDGE_SIZE) {
	    callback(new RangeError("Block X index '" + x + "' out of range"));
	    return;
	}
	z = Number(z);
	z = (z == null) ? -1 : Math.floor(z);
	if (z < 0 || z >= CHUNK_EDGE_SIZE) {
	    callback(new RangeError("Block Z index '" + z + "' out of range"));
	    return;
	}
	x += (z * 32);
    }

    // util.log("getting index entry for " + x);

    // TODO consider if it's faster to do two small reads
    // instead of the whole index when the cache is off
    this.getIndex(
	function(err, index) {
	    if (err) {
		callback(err);
		return;
	    }
	    var entry = index.get(x);
	    callback(null, entry[0], entry[1], entry[2]);
	});
}

Region.prototype.getRawEntryData = function(entryTime, offset, blocks, callback) {
    if (!offset || !blocks) {
	// No data
	callback(null, null, entryTime);
	return;
    }

    var file = this._blockfile;
    if (file== null) {
	var that = this;
	this.open(function(err) {
	    if (err) {
		callback(err);
	    } else {
		that.getRawEntryData(entryTime, offset, blocks, callback);
	    }
	});
	return;
    }

    try {
	file.read(offset, blocks, 
		  function(err, buf) {
		      if (err) {
			  callback(err);
			  return;
		      }
		      callback(null, buf, entryTime);
		  });
    } catch(e) {
	callback(e);
    }

}

// TODO consider caching these buffers?
Region.prototype.getRawChunkData = function(x, z, callback) {
    if (callback == null) {
	callback = z;
	z = null;
    }

    var that = this;
    this.getIndexEntry(x, z,
	function(err, entryTime, offset, blocks) {
	    if (err) {
		callback(err);
		return;
	    }
	    that.getRawEntryData(entryTime, offset, blocks, callback);
	});
}

Region.prototype.getChunkStream = function(x, z, callback) {
    if (callback == null) {
	callback = z;
	z = null;
    }
    var dataCallback = function(err, data, time) {
	if (err) {
	    callback(err);
	}
	if (data == null) {
	    callback(null, data, time);
	    return;
	}
	var compressedLength = data.readInt32BE(0) - 1;
	var compressionType = data.readInt8(4);

	var zStream;
	if (compressionType == ENCODING_GZIP) {
	    zStream = zlib.createGunzip();
	} else if (compressionType == ENCODING_DEFLATE) {
	    zStream = zlib.createInflate();
	} else {
	    callback(new Error("Unknown compression type " + compressionType));
	    return;
	}
	callback(null, zStream, time);
	var slicedBuffer = data.slice(5, compressedLength + 5);
	zStream.write(slicedBuffer);
	zStream.end();
    }

    this.getRawChunkData(x, z, dataCallback);
}

Region.prototype.getChunkObject = function(x, z, callback) {
    if (callback == null) {
	callback = z;
	z = null;
    }

    var tagReader;
    var obj;
    var objTime;

    var objCallback = function(err, object, entry) {
	if (err) {
	    //util.log("Failed to get chunk object");
	    callback(err);
	    return;
	}
	if (object == null) {
	    //util.log("Got a chunk object");
	    callback(null, obj, objTime);
	    return;
	}

	if (obj != null) {
	    //util.log("Got duplicate chunk object");
	    callback(new Error("Chunk object is not alone!"));
	    return;
	}

	if (entry.id != '') {
	    //util.log("Got named chunk object");
	    callback(new Error("Chunk object is unexpectedly named '" + name + "'"));
	    return;
	}

	obj = object;
	tagReader.readObject(objCallback);
    }

    this.getChunkStream(x, z,
			function(err, stream, time) {
			    if (err) {
				util.log("Failed chunk stream");
				callback(err);
				return;
			    }
			    if (stream == null) {
				//util.log("Null chunk stream");
				callback(err, null, time);
				return;
			    }
			    objTime = time;
			    tagReader = stream.pipe(new tagio.TagReader());
			    tagReader.readObject(objCallback);
			});
};

Region.prototype.getChunk = function(x, z, callback) {
    if (callback == null) {
	callback = z;
	z = null;
    }
    this.getChunkObject(x, z,
			function(err, chunkObj, chunkTime) {
	if (err) {
	    callback(err);
	} else if (chunkObj == null) {
	    callback(null, null, chunkTime);
	} else {
	    try {
		var chunk = new Chunk(chunkObj, chunkTime);
	    } catch (e) {
		callback(e);
		return;
	    }
	    callback(null, chunk, chunkTime);
	}
    });
}

Region.prototype.forAllChunks = function(iterator, callback) {
    var curIndex = -1;
    var that = this;

    var next;
    var failed = false;
    var chunkCallback = function(err, chunk, chunkTime) {
	if (failed) {
	    if (err) {
		util.log("Ignoring extra error: " + err);
	    }
	    return;
	}
	if (err) { 
	    failed = true;
	    // util.log("Failed chunk - calling back: " + JSON.stringify(err));
	    callback(err); 
	    return;
	}
	if (chunk) {
	    iterator(chunk, next);
	    return;
	}
	// util.log("No chunk for " + curIndex);
	next();
    }
    var next = function(err) {
	if (failed) {
	    if (err) {
		util.log("Ignoring extra error: " + err);
	    }
	    return;
	}
	if (err) { 
	    // util.log("Failed next - calling back");
	    failed = true;
	    callback(err); 
	    return;
	}
	++curIndex;
	if (curIndex >= BLOCK_CHUNKS) { 
	    // util.log("Iteration complete - calling back");
	    callback();
	    return;
	}
	that.getChunk(curIndex, chunkCallback);
    }
    next();
}

// TODO Consistency update on index vs x,z
// TODO consider correct balance of serials
//
//  perhaps writeRawChunkData(idx, ...) writeRawChunkDataXZ(x, z, ...)
//  etc
Region.prototype.writeRawChunkData = function(idx, data, entryTime, callback) {
    if (callback == null) {
	callback = entryTime;
	entryTIme = null;
    }
    if (!this.writable) {
	callback(new Error("This region is not writable"));
	return;
    }
    if (entryTime == null) {
	entryTime = Math.floor(Date.now() / 1000);
    } else if (util.isDate(entryTime)) {
	entryTime = Math.floor(entryTime.getTime() / 1000);
    } else {
	entryTime = Math.floor(Number(entryTime) || 0);
    }

    util.log("Preparing to write " + idx + " " + entryTime);

    var that = this;

    var indexWriteCallback = function(err, wrote, serial) {
	callback(err, wrote, serial);
    }

    this.getIndex(function(err, index, fileSerial) {
	if (err) {
	    callback(err); return;
	}
	util.log("Got index: serial: " + index.serial
		 + ": fileSerial: " + fileSerial);

	// TODO possible serial abort here

	if (data == null) {
	    // Special case, no blocks or block offset.
	    var entry = index.get(idx);
	    if (entry[0] == entryTime && !entry[1]) {
		callback(null, fileSerial);
		return;
	    }
	    util.log("Only need to update index...");
	    var buf = index.getBufferCopy();
	    buf.writeUInt32BE(0, idx * 4);
	    buf.writeUInt32BE(entryTime, idx * 4 + BLOCK_SIZE);
	    that._blockfile.writeUnlessChanged(0, buf, index.serial,
					       indexWriteCallback);
	    return;
	}
	callback(new Error("Not Yet Implemented"));
    });

}

Region.prototype.close = function() {
    if (this._fd == null) { return; }
    var fd = this._fd;
    this._fd = null;
    try {
	fs.close(fd);
    } catch (e) {
	util.log("WARNING: Close failed: " + e);
    }
}

// Alright, now to think about region changes. Assuming everyone is well
// behaved these fall in to the following pattern..
//
// INDEX REVIEW - Determine where the change is going to happen
// FILE CHANGE - Modify the chunk, but not the index
// INDEX CHANGE - Modify the index to reflect the file change
//
// During the INDEX REVIEW nothing else should be blocked, but other
// region changes should wait because they're planning their next move
//
// During the FILE CHANGE there needs to be coordination with anything
// reading the part of the file that's changing (and any other changes
// are still blocked).
//
// During the INDEX CHANGE nobody can use the index, but possibly the rest of
// the file is alright.
//
// I wonder if this can be built atop a more generalized block reservation
// scheme since it's really just about the IO and not so much the regionness.


exports.Region = Region;

