// Minecraft stuff
// Daniel Stephens (iriel@iriel.org), Jan 2013

var fs = require('fs');
var util = require('util');
var tagio = require('./minecraft-tagio');
var iohelpers = require('./iohelpers');
var zlib = require('zlib');

// Region IO Experimeents

const BLOCK_SIZE = 4096;
const BLOCK_CHUNKS = BLOCK_SIZE / 4;
const CHUNK_EDGE_SIZE = 32;

const ENCODING_GZIP = 1;
const ENCODING_DEFLATE = 2;

// ---------------------------------------------------------------------------

function notifyPending(obj, property) {
    var callbacks = obj[property];
    if (callbacks == null) { return; }
    obj[property] = null;

    var argsArray = Array.prototype.slice.call(arguments, 2);
    for (var i = 0; i < callbacks.length; ++i) {
	var cb = callbacks[i];
	if (cb != null) { cb.apply(null, argsArray); }
    }
}

// ---------------------------------------------------------------------------

var Chunk  = function(taggedObj, saveTime) {
    if (!taggedObj.Level) {
	throw new Error("Chunk object without level!");
    }
    this._obj = taggedObj;
    this._saveTime = saveTime;

    var level = taggedObj.Level;
    this._level = level;
    this._entities = level.Entities;
    this._biomes = level.Biomes;
    this._tileEntities = level.TileEntities;
    this._heightMap = level.HeightMap;

    /*util.log('New Chunk [' + this.getXPos() + "," + this.getZPos() + "] time="
	     + new Date(saveTime * 1000)); */
}

Chunk.prototype.getXPos = function() { return this._level.xPos; }

Chunk.prototype.getZPos = function() { return this._level.zPos; }

Chunk.prototype.summarize = function() {
    var tileEntities = this._tileEntities;
    for (var i = 0; i < tileEntities.length; ++i) {
	var ent = tileEntities[i];
	var desc = i + " [" + ent.x + "," + ent.y + "," + ent.z
		    + "] " + ent.id;

	if (ent.id == 'Sign') {
	    desc = desc + " "
		+ ent.Text1 + "/" + ent.Text2 + "/" + ent.Text3 + "/" + ent.Text4;
	} else if (ent.id == 'Chest') {
	    desc = desc + " Items: " + ent.Items.length;
	}

	console.log(desc);
    }
}

exports.Chunk = Chunk;

// ---------------------------------------------------------------------------

var DEFAULT_REGION_OPTIONS = {
    sync : false,
    writable : false,
    indexCache : true,
    indexCheck : false
};

var createOptions = function(defaults, opts) {
    var result = {};
    for (var k in Object.keys(defaults)) {
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

var Region = function(path, opts) {
    var options = createOptions(DEFAULT_REGION_OPTIONS, opts);
    this._options = options;
    this.path = path;
    this._changeSerial = 0;
    this._indexSerial = 0;
    this.writable = Boolean(options.writable);
    this.sync = Boolean(options.sync);
    this.indexCache = Boolean(options.indexCache);
    this.indexCheck = Boolean(options.indexCheck);
    
}

Region.prototype.open = function(callback) {
    if (this._fd != null) {
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
	    // Update the change serial to invalidate cache assumptions
	    that._changeSerial++;
	    that._fd = fd;
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

var loadIndexCallback = function(that, reqSerial, err, buf) {
    if (err) {
	notifyPending(that, '_indexLoading', err);
	return;
    }
    if (buf != null && reqSerial == that._changeSerial) {
	// The result IS useful
	if (that.indexCache) {
	    that._index = buf;
	    that._indexSerial = reqSerial;
	}
	notifyPending(that, '_indexLoading', null, buf);
	return;
    }
    // Otherwise need to (re) fetch
    var fd = that._fd;
    if (fd == null) {
	that.open(function(err, self) {
	    loadIndexCallback(that, null, err);
	});
	return;
    }

    var indexBuf = new Buffer(BLOCK_SIZE * 2);
    var serial = that._changeSerial;
    iohelpers.readFully(fd, 0, indexBuf, function(err, buf) {
	loadIndexCallback(that, serial, err, buf);
    });
}

Region.prototype.getIndex = function(callback) {
    if (this._index && this.indexCache) {
	if (this._indexSerial == this._changeSerial) {
	    callback(null, this._index);
	    return;
	}
    }

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

    // TODO consider if it's faster to do two small reads
    // instead of the whole index when the cache is off
    this.getIndex(
	function(err, index) {
	    if (err) {
		callback(err);
		return;
	    }

	    var entry = index.readInt32BE(x * 4);
	    var entryTime = index.readInt32BE(x * 4 + BLOCK_SIZE);
	    callback(null, entry, entryTime);
	});
}

Region.prototype.getRawEntryData = function(entry, entryTime, callback) {
    if (entry == 0) {
	// No data
	callback(null, null, entryTime);
	return;
    }

    var fd = this._fd;
    if (fd == null) {
	var that = this;
	this.open(function(err) {
	    if (err) {
		callback(err);
	    } else {
		that.getRawEntryData(entry, entryTime, callback);
	    }
	});
	return;
    }

    var entryOffset = (entry >>> 8);
    var entryBlocks = (entry & 0x0ff);
    try {
	var entryBuffer = new Buffer(entryBlocks * BLOCK_SIZE);
	// util.log("FD " + fd + " Index: " + x + " Entry: " + entry + " Offset: " + entryOffset + " Size: " + entryBlocks);
	iohelpers.readFully(fd, entryOffset * BLOCK_SIZE, entryBuffer,
			    function(err, buf) {
				if (err) {
				    callback(err);
				    return;
				}
				callback(null, entryBuffer, entryTime);
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
	function(err, entry, entryTime) {
	    if (err) {
		callback(err);
		return;
	    }
	    that.getRawEntryData(entry, entryTime, callback);
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

    var objCallback = function(err, object, name) {
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

	if (name != '') {
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

// ---------------------------------------------------------------------------

var REGION_FILE_PATTERN = /^r[.]([-]?[0-9]+)[.]([-]?[0-9]+)[.]mca$/;

var Dimension = function(path) {
    this._root = path;

    util.log("Created dimension: " + path);
}

Dimension.prototype.getIndex = function(callback) {
    var index = this._index;
    if (index) {
	callback(null, index);
	return;
    }
    if (this._indexPending) {
	this._indexPending.push(callback);
	return;
    }
    this._indexPending = [ callback ];

    var that = this;
    // TODO use the path module
    fs.readdir(this._root + "/region/", function(err, files) {
	if (err) {
	    notifyPending(that, '_indexPending', err);
	    return;
	}

	var minX, maxX, minZ, maxZ;
	var map = {};
	for (var i = 0; i < files.length; ++i) {
	    var file = files[i];
	    var match = file.match(REGION_FILE_PATTERN);
	    if (!match) { continue; }
	    var x = Number(match[1]);
	    var z = Number(match[2]);
	    if (minX == null) {
		minX = x;
		maxX = x;
		minZ = z;
		maxZ = z;
	    } else {
		if (x < minX) { minX = x; } else if (x > maxX) { maxX = x; }
		if (z < minZ) { minZ = z; } else if (z > maxZ) { maxZ = z; }
	    }
	    var xMap = map[x];
	    if (xMap == null) {
		xMap = {};
		map[x] = xMap;
	    }
	    xMap[z] = file;
	}

	map.minX = minX,
	map.maxX = maxX,
	map.minZ = minZ,
	map.maxZ = maxZ,

	that._index = map;
	notifyPending(that, '_indexPending', null, map);
    });
}

Dimension.prototype._loadRegion = function(rFile, opts, callback) {
    // TODO use path module
    var path = this._root + "/region/" + rFile;
    callback(null, new Region(path, opts));
}

Dimension.prototype.openRegion = function(x, z, opts, callback) {
    if (callback == null) {
	callback = opts;
	opts = null
    }
    var that = this;
    x = Number(x);
    z = Number(z);
    this.getIndex(function(err, index) {
	if (err) { callback(err); return; }
	var xMap = index[x];
	if (!xMap) {
	    callback(null);
	    return;
	}
	var rFile = xMap[z];
	if (!rFile) {
	    callback(null);
	    return;
	}
	that._loadRegion(rFile, opts, callback);
    });
}

Dimension.prototype.forAllRegions = function(opts, iterator, callback) {
    if (arguments.length < 3) {
	callback = iterator;
	iterator = opts;
	opts = null;
    }

    var cx, cz, index;
    var that = this;
    var iterNext;
    var doThis = function(err, region) {
	if (err) {
	    callback(err);
	    return;
	}
	if (region) {
	    iterator(region, iterNext);
	    return;
	}
	var xmap = index[cx];
	while (true) {
	    ++cz;
	    if (cz > index.maxZ) {
		cz = index.minZ;
		while (true) {
		    ++cx;
		    if (cx > index.maxX) {
			// Done!
			callback(null);
			return;
		    }
		    xmap = index[cx];
		    if (xmap) { break; }
		}
	    }
	    var rFile = xmap[cz];
	    if (rFile) {
		that._loadRegion(rFile, opts, doThis);
		return;
	    }
	}
    }
    iterNext = function(err) {
	if (err) {
	    callback(err);
	}
	doThis();
    }
    this.getIndex(function(err, cbIndex) {
	if (err) {
	    callback(err);
	    return;
	}
	index = cbIndex;
	cx = cbIndex.minX;
	cz = cbIndex.minZ - 1;
	doThis();
    });
}

Dimension.prototype.forAllRegions2 = function(opts, iterator, callback, limit) {
    if (arguments.length < 3) {
	callback = iterator;
	iterator = opts;
	opts = null;
    } else if (arguments.length == 3 && typeof(callback) == 'number') {
	limit = callback;
	callback = iterator;
	iterator = opts;
	opts = null;
    }
    var that = this;

    var fileList;
    var pending = 0;
    var limit = Number(limit) || 5;
    var error;

    var next = function(err) {
	--pending;
	if (err) {
	    if (error == null) {
		// This is the first error
		error = err;
		fileList = [];
	    } else {
		util.log("Ignoring subsequent error: " + err);
		util.log(err.stack);
	    }
	}
	if (pending == 0 && fileList.length == 0) {
	    // All done!
	    callback(error);
	    return;
	}
	dispatch();
    }

    var doRegion = function(err, region) {
	if (err) {
	    next(err);
	    return;
	}
	iterator(region, next);
    }

    var dispatch = function() {
	while (pending < limit && fileList.length > 0) {
	    var todo = fileList.shift();
	    ++pending;
	    that._loadRegion(todo, opts, doRegion);
	}
    }

    this.getIndex(function(err, index) {
	if (err) {
	    callback(err);
	    return;
	}
	var allFiles = [];
	for (var cx = index.minX; cx <= index.maxX; ++cx) {
	    var xMap = index[cx];
	    if (!xMap) { continue; }
	    for (var cz = index.minZ; cz <= index.maxZ; ++cz) {
		var rFile = xMap[cz];
		if (rFile) { allFiles.push(rFile); }
	    }
	}
	fileList = allFiles;
	dispatch();
    });
}

exports.Dimension = Dimension;
