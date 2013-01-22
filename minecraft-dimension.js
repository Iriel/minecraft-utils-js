// Minecraft stuff - Dimension
// Daniel Stephens (iriel@iriel.org), Jan 2013

var fs = require('fs');
var util = require('util');

// ---------------------------------------------------------------------------

var internal = require('./minecraft-internal');
const notifyPending = internal.notifyPending;

const Region = require('./minecraft-region').Region;

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
	    var entry = { x : x, z : z, name : file };
	    xMap[z] = entry;
	    map[file] = entry;
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
    var entry = this._index[rFile];
    if (!entry) {
	callback("No region for " + rFile);
    } else {
	var path = this._root + "/region/" + entry.name;
	callback(null, new Region(path, entry.x, entry.z, opts));
    }
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
	var entry = xMap[z];
	if (!entry) {
	    callback(null);
	    return;
	}
	that._loadRegion(entry.name, opts, callback);
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
	    var entry = xmap[cz];
	    if (entry) {
		that._loadRegion(entry.name, opts, doThis);
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
		if (err.stack) {
		    util.log(err.stack);
		}
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
		var entry = xMap[cz];
		if (entry) { allFiles.push(entry.name); }
	    }
	}
	fileList = allFiles;
	dispatch();
    });
}

exports.Dimension = Dimension;
