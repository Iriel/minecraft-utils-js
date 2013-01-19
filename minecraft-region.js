// Minecraft stuff
// Daniel Stephens (iriel@iriel.org), Jan 2013

var fs = require('fs');
var util = require('util');
var tagio = require('./minecraft-tagio');
var zlib = require('zlib');

// Region IO Experimeents

var BLOCK_SIZE = 4096;
var BLOCK_CHUNKS = BLOCK_SIZE / 4;
var CHUNK_EDGE_SIZE = 32;

var ENCODING_GZIP = 1;
var ENCODING_DEFLATE = 2;

// ---------------------------------------------------------------------------

function readFully(fd, ofs, buffer, pos, toRead, callback) {
    if (toRead == null) {
	callback = pos;
	pos = 0;
	toRead = buffer.length;
    } else if (callback == null) { 
	callback = toRead;
	toRead = buffer.length - pos;
    }
    ofs -= pos;
    var toGet = toRead;

    if (toGet == 0) {
	callback(null, buffer);
	return;
    }
    var readCallback = function(err, bytesRead, buffer) {
	if (err) {
	    // util.log("Error in readCallback " + JSON.stringify(err));
	    callback(err);
	    return;
	}
	if (bytesRead == 0) {
	    var err = new Error("EOF during read");
	    //util.log("Zero read " + JSON.stringify(err));
	    callback(err);
	    return;
	}
	// TODO fail if bytesRead == 0?
	toGet -= bytesRead;
	pos += bytesRead;
	if (toGet < 0) {
	    callback(new Error("Assertion failed; Got more data than requested"));
	    return;
	}
	if (toGet > 0) {
	    //util.log("Reading " + fd + " " + pos + " " + toGet + " " + (ofs + pos));
	    fs.read(fd, buffer, pos, toGet, ofs + pos, readCallback);
	} else {
	    callback(null, buffer);
	}
    }
    //util.log("Reading " + fd + " " + pos + " " + toGet + " " + (ofs + pos));
    fs.read(fd, buffer, pos, toGet, ofs + pos, readCallback);
}

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
var ManagedFileDescriptor = function(fd) {
    this._fd = fd;
    this._users = 0;
    this._handles = [];
    this._closing = false;
}

var handleId = 0;

var RESET_OWNER = function() { "RESET_OWNER" };

ManagedFileDescriptor.prototype.use = function() {
    if (this._closing) {
	throw new Error("Descriptor is closing!");
    }
    var curFd = this._fd;
    var that = this;
    var curId = ++handleId;
    var func = function(arg, other) {
	if (arg == RESET_OWNER) {
	    that = other;
	} else if (arg == false) {
	    //util.log("Releasing handle " + curId + " " + curFd);
	    if (curFd != null) {
		that._release(func);
	    }
	    curFd = null;
	} else {
	    if (curFd == null) {
		throw new Error("Null file descriptor!!");
	    }
	    return curFd; 
	}
    }
    ++this._users;
    // util.log("Created handle " + handleId + " " + curFd + " " + Object.keys(this._handles).length);
    this._handles.push(func);
    return func;
}

ManagedFileDescriptor.prototype._release = function(func) {
    var handles = this._handles;
    for (var i = 0; i < handles.length; ++i) {
	if (handles[i] == func) {
	    handles.splice(i, 1);
	    --this._users;
	    if (this._users == 0) {
		if (this._closing) {
		    fs.close(this._fd);
		    this._fd = null;
		}
	    }
	    return;
	}
    }
    throw new Error("Attemped to remove unknown handle");
}

ManagedFileDescriptor.prototype.replace = function(fd) {
    if (this._users > 0) {
	var replacement = new ManagedFileDescriptor(this._fd);
	var handles = this._handles;

	replacement._users = this._users;
	replacement._handles = handles;

	this._users = null;
	this._handles = [];

	for (var i = 0; i < handles.length; ++i) {
	    handles[i](RESET_OWNER, replacement);
	}
	replacement.close();
    } else if (this._fd != null) {
	this.close();
    }
    this._fd = fd;
    this._closing = false;
}

ManagedFileDescriptor.prototype.close = function () {
    if (this._fd == null) { return; }
    this._closing = true;
    if (this.users > 0) { return; }
    var fd = this._fd;
    this._fd = null;
    fs.close(fd);
}

ManagedFileDescriptor.prototype.isOpen = function() {
    return ((!this._closing) && (this._fd != null));
}


// ---------------------------------------------------------------------------

var RegionFile = function(filename) {
    this.filename = filename;
}

// TODO revisit this, make it more awesome (asynchronous?)
RegionFile.prototype._getFileHandle = function() {
    var mfd = this._managedFd;
    if (mfd && mfd.isOpen()) {
	return mfd.use();
    }

    var path = this.filename;
    var that = this;
    var fd = fs.openSync(path,  "r");
    if (mfd) {
	mfd.replace(fd);
    } else {
	mfd = new ManagedFileDescriptor(fd);
	this._managedFd = mfd;
    }
    return mfd.use();
}

RegionFile.prototype.getIndex = function(callback) {
    if (this._index) {
	callback(null, this._index);
	return;
    }

    if (this._indexLoading) {
	this._indexLoading.push(callback);
	return;
    }

    this._indexLoading = [ callback ];
    var that = this;

    var indexBuf = new Buffer(BLOCK_SIZE * 2);
    var handle = this._getFileHandle();
    readFully(handle(), 0, indexBuf, function(err, buf) {
	handle(false);
	if (err) {
	    notifyPending(that, '_indexLoading', err);
	}
	that._index = buf;
	notifyPending(that, '_indexLoading', null, buf);
    });
}

// TODO consider caching these buffers?
RegionFile.prototype.getRawChunkData = function(x, z, callback) {
    if (callback == null) {
	callback = z;
	z = 0;
    } else {
	x += z * 32;
    }

    var handle = this._getFileHandle();

    this.getIndex(function(err, index) {
	if (err) {
	    handle(false);
	    callback(err);
	    return;
	}

	var entry = index.readInt32BE(x * 4);
	if (entry == 0) {
	    // No data
	    handle(false);
	    callback(null);
	    return;
	}
	var entryTime = index.readInt32BE(x * 4 + BLOCK_SIZE);
	var entryOffset = (entry >>> 8);
	var entryBlocks = (entry & 0x0ff);
	var entryBuffer = new Buffer(entryBlocks * BLOCK_SIZE);
	// util.log("FD " + fd + " Index: " + x + " Entry: " + entry + " Offset: " + entryOffset + " Size: " + entryBlocks);
	readFully(handle(), entryOffset * BLOCK_SIZE, entryBuffer,
		  function(err, buf) {
		      handle(false);
		      if (err) {
			  callback(err);
			  return;
		      }
		      callback(null, entryBuffer, entryTime);
		  });
    });
}

RegionFile.prototype.getChunkStream = function(x, z, callback) {
    if (callback == null) {
	callback = z;
	z = 0;
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

RegionFile.prototype.getChunkObject = function(x, z, callback) {
    if (callback == null) {
	callback = z;
	z = 0;
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

RegionFile.prototype.forAllChunks = function(iterator, callback) {
    var curIndex = -1;
    var that = this;

    var next;
    var chunkCallback = function(err, chunk, chunkTime) {
	if (err) { 
	    // util.log("Failed chunk - calling back: " + JSON.stringify(err));
	    throw new Error("BROKE HERE");
	    callback(err); 
	    return;
	}
	if (chunk) {
	    iterator(new Chunk(chunk, chunkTime), next);
	    return;
	}
	// util.log("No chunk for " + curIndex);
	next();
    }
    var next = function(err) {
	if (err) { 
	    // util.log("Failed next - calling back");
	    callback(err); 
	    return;
	}
	++curIndex;
	if (curIndex >= BLOCK_CHUNKS) { 
	    // util.log("Iteration complete - calling back");
	    callback();
	    return;
	}
	that.getChunkObject(curIndex, chunkCallback);
    }
    next();
}

RegionFile.prototype.close = function() {
    if (!this._managedFd) { return; }
    this._managedFd.close();
}

exports.RegionFile = RegionFile;

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

Dimension.prototype._loadRegionFile = function(rFile, callback) {
    // TODO use path module
    var path = this._root + "/region/" + rFile;
    callback(null, new RegionFile(path));
}

Dimension.prototype.getRegion = function(x, z, callback) {
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
	that._loadRegionFile(rFile, callback);
    });
}

Dimension.prototype.forAllRegions = function(iterator, callback) {
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
		that._loadRegionFile(rFile, doThis);
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

Dimension.prototype.forAllRegions2 = function(iterator, callback, limit) {
    var that = this;

    var fileList;
    var pending = 0;
    var limit = Number(limit) || 5;
    var error;

    var next = function(err) {
	--pending;
	if (err) {
	    if (!error) {
		// This is the first error
		error = err;
		fileList = [];
	    } else {
		util.log("Ignoring subsequent error: " + JSON.stringify(err));
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
	    that._loadRegionFile(todo, doRegion);
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
