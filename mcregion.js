// Minecraft stuff
// Daniel Stephens (iriel@iriel.org), Jan 2013

var fs = require('fs');
var util = require('util');
var tagio = require('./minecraft-tagio');

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
	    callback(err);
	    return;
	}
	if (bytesRead == 0) {
	    callback(new Error("EOF during read"));
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
	    fs.read(fd, buffer, pos, toGet, ofs + pos, readCallback);
	} else {
	    callback(null, buffer);
	}
    }
    fs.read(fd, buffer, pos, toGet, ofs + pos, readCallback);
}
// ---------------------------------------------------------------------------

var RegionFile = function(fd) {
    this.fd = fd;
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
    readFully(fd, 0, indexBuf, function(err, buf) {
	var callbacks = that._indexLoading;
	this._indexLoading = null;
	if (err) {
	    if (callbacks) {
		for (var i = 0; i < callbacks.length; ++i) {
		    callbacks[i](err);
		}
	    }
	}
	that._index = buf;
	if (callbacks) {
	    for (var i = 0; i < callbacks.length; ++i) {
		callbacks[i](null, buf);
	    }
	}
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

    var fd = this.fd;

    this.getIndex(function(err, index) {
	if (err) {
	    callback(err);
	    return;
	}

	var entry = index.readInt32BE(x * 4);
	if (entry == 0) {
	    // No data
	    callback(null);
	    return;
	}
	var entryTime = index.readInt32BE(x * 4 + BLOCK_SIZE);
	var entryOffset = (entry >>> 8);
	var entryBlocks = (entry & 0x0ff);
	var entryBuffer = new Buffer(entryBlocks * BLOCK_SIZE);
	readFully(fd, entryOffset * BLOCK_SIZE, entryBuffer,
		  function(err, buf) {
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
	    callback(err);
	    return;
	}
	if (object == null) {
	    callback(null, obj, objTime);
	    return;
	}

	if (obj != null) {
	    callback(new Error("Chunk object is not alone!"));
	    return;
	}

	if (name != '') {
	    callback(new Error("Chunk object is unexpectedly named '" + name + "'"));
	    return;
	}

	obj = object;
	tagReader.readObject(objCallback);
    }

    this.getChunkStream(x, z,
			function(err, stream, time) {
			    if (err) {
				callback(err);
				return;
			    }
			    if (stream == null) {
				callback(err, null, time);
				return;
			    }
			    objTime = time;
			    tagReader = stream.pipe(new tagio.TagReader());
			    tagReader.readObject(objCallback);
			});
};

exports.RegionFile = RegionFile;

// ---------------------------------------------------------------------------
var fd = fs.openSync('testdata/NextEdenReal/CogRail3/region/r.0.0.mca', 'r');

var region = new RegionFile(fd);

region.getIndex(function(err, buf) {
    if (err) {
	throw new Error(err);
    }

    for (var i = 0; i < buf.length / 2; i += 4) {
	var entry = buf.readInt32BE(i);
	var entryX = (i / 4) & 0x01f;
	var entryZ = i >>> 7;
	var entryTime = new Date(buf.readInt32BE(i + BLOCK_SIZE) * 1000);
	var entryBlocks = (entry & 0x0ff);
	var entryOffset = (entry >>> 3);
	console.log(entryX + "\t" + entryZ + "\t" + entryOffset + "\t" + entryBlocks
		    + "\t" + entryTime);
    }
});

var zlib = require('zlib');

function tagReaderCallback(err, tagReader) {
    var tagCallback = function(err, tag, tagName) {
	if (err) {
	    throw new Error(err);
	}
	    
	tagReader.readObject(tagCallback);
    }
    tagReader.readObject(tagCallback);
}

region.getChunkObject(1, 22, function(err, tag, time) {
    if (err) {
	throw new Error(err);
    }
    if (tag == null) { 
	console.log("[END]");
	return;
    }
    tag = tag.Level;
    var keys = Object.keys(tag);
    for (var i = 0; i < keys.length; ++i) {
	console.log("Got tag [" + time  + "] with " + keys[i]);
    }
    console.log(JSON.stringify(tag.Entities));
});
