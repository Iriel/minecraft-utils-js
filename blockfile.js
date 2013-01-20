// Minecraft Stuff - Block-Managed File Abstraction
//
// Daniel Stephens (iriel@iriel.org)
// ---------------------------------------------------------------------------
// An abstraction for dealing with a file made up of blocks
//
// The following assumptions apply
//
// -- Any "atomic" block operations operate on contiguous blocks
// -- Much of the time external interference is not an issue
// -- There needs to be some way to check for potential change
//    (with varying degrees of paranoia).
//    - Assume nothing
//    - Assume all changes came from self
//    - Assume file size/mtime are sufficient
// -- I'll make file descriptor management the users' responsibility
// -- there are FAR less than MAXINT changes made in a 'session'
// -- writes can be callback-managed
// -- Serials need to allow comparison of changes between blocks
// -- Most of the time there aren't any writes
// ---------------------------------------------------------------------------

var iohelpers = require('./iohelpers');
var util = require('util');

function isInteger(val) {
    return (val === Math.floor(Number(val)));
}

// fd - the file descriptor
// opts - Map of options
//   blockSize - the size of each block
//   writable - whether write operations are permitted at all
//   initialSerial - initial serial value

var BlockFile = function(fd, opts) {
    this.fd = fd;
    if (opts == null) { opts = {}; }
    var blockSize = opts.blockSize;
    var initSerial = opts.initSerial;
    if (initSerial == null) { initSerial = 0; }
    var writable = opts.writable;

    if (!isInteger(blockSize) || blockSize <= 0) {
	throw new RangeError('blockSize ' + blockSize
			     + ' is not a positive integer');
	return;
    }
    if (!isInteger(initSerial) || initSerial < 0) {
	throw new RangeError('initSerial ' + initSerial
			     + ' is not a non-negative integer');
	return;
    }
    this.blockSize = blockSize;
    this.writable = Boolean(writable);
    this._serials = [];
    this._rLocks = {};
    // Write locks, each is an array whose first three members are the
    // lower limit (incl) and upper limit (excl) of the write,
    // and the 'write allowed' callback, 
    // then the remainder are any callbacks to fire when the
    // write completes
    this._wLocks = [];
    this._serial = initSerial;
    this._initSerial = initSerial;
}

// TODO consider the relative merits of doing this asynchronously
BlockFile.prototype.getCurrentSerial = function() {
    return this._serial;
}

BlockFile.prototype.getReadDefaultSerial = function() {
    return this._initSerial;
}

// Read length blocks, starting at block index, invoking the callback
// when done.
//
// index - block offset (integer >= 0)
// length - block count (integer > 0)
// oldSerial - old serial, null for none
// callback(err, buffer, blocksStartSerial, fileEndSerial);
BlockFile.prototype.readIfChanged = function(index, length, oldSerial, callback) {
    if (!isInteger(index) || index < 0) {
	callback(new Error('Index ' + index
			   + ' is not a non-negative integer'));
	return;
    }
    if (!isInteger(length) || length <= 0) {
	callback(new Error('Length ' + length + ' is not a positive integer'));
	return;
    }
    const indexLim = index + length;
    var i;
    const that = this;
    const writeLocks = this._wLocks;
    // Am I blocked by pending writing?
    for (i = 0; i < writeLocks.length; ++i) {
	var lock = writeLocks[i];
	if (lock[0] >= indexLim) { continue; }
	if (lock[1] <= index) { continue; }
	lock.push(function() {
	    that.readIfChanged(index, length, oldSerial, callback);
	});
	return;
    }

    const blockSize = this.blockSize;
    const buffer = new Buffer(length * blockSize);

    // Otherwise get and check serial, and if needed, lock the read
    const serials = this._serials;
    const defaultSerial = this.getReadDefaultSerial();
    var blockStartSerial = -1;
    for (i = index; i < indexLim; ++i) {
	var ser = serials[i];
	if (ser == null) {
	    ser = defaultSerial;
	}
	if (ser > blockStartSerial) { blockStartSerial = ser; }
    }
    if (oldSerial == blockStartSerial) {
	callback(null, null, blockStartSerial, that.getCurrentSerial());
	return;
    }

    const readLocks = this._rLocks;
    for (i = index; i < indexLim; ++i) {
	var cur = readLocks[i];
	if (cur < 0) {
	    throw Error("Illegal state - negative lock count");
	}
	readLocks[i] = (cur || 0) + 1;
    }
    
    var readCallback = function(err, buffer) {
	var endSerial = that.getCurrentSerial();
	var checkWrites = false;
	for (var i = index; i < indexLim; ++i) {
	    var cur = readLocks[i];
	    if (cur == 1) {
		delete readLocks[i];
	    } else if (cur == -1) {
		checkWrites = true;
		delete readLocks[i];
	    } else if (cur < 0) {
		readLocks[i] = cur + 1;
	    } else {
		readLocks[i] = cur - 1;
	    }
	}
	if (checkWrites) {
	    that._checkWrites();
	}
	callback(err, buffer, blockStartSerial, endSerial);
    }
    iohelpers.readFully(this.fd, 
			index * blockSize, buffer, readCallback);
}

// Read length blocks, starting at block index, invoking the callback
// when done.
//
// index - block offset (integer >= 0)
// length - block count (integer > 0)
// callback(err, buffer, serial);
BlockFile.prototype.read = function(index, length, callback) {
    this.readIfChanged(index, length, null, callback);
}

// callback(err, wrote, serial);
BlockFile.prototype.writeUnlessChanged = function(index, buffer, checkSerial, callback) {
    if (!this.writable) {
	callback(new Error("Block file is not writable"));
	return
    }
    if (!isInteger(index) || index < 0) {
	callback(new Error('Index ' + index
			   + ' is not a non-negative integer'));
	return;
    }
    var length = Math.ceil(buffer.length / this.blockSize);
    if (!isInteger(length) || length <= 0) {
	callback(new Error('Length ' + length + ' is not a positive integer'));
	return;
    }
    const indexLim = index + length;
    const that = this;
    const blockSize = this.blockSize;
    var actionCallback = function(err, next) {
	if (err) {
	    callback(err);
	    return;
	}

	const serials = that._serials;
	const defaultSerial = that.getReadDefaultSerial();
	if (checkSerial != null) {
	    // Check the serial number
	    var curSerial = -1;
	    for (i = index; i < indexLim; ++i) {
		var ser = serials[i];
		if (ser == null) {
		    ser = defaultSerial;
		}
		if (ser > curSerial) { curSerial = ser; }
	    }
	    if (checkSerial < curSerial) {
		next();
		callback(null, false, curSerial);
		return;
	    }
	}
	// Increment serial before the change
	var serial = ++that._serial;
	for (i = index; i < indexLim; ++i) {
	    serials[i] = serial;
	}

	iohelpers.writeFully(that.fd,
			     index * blockSize, buffer,
			     function(err) {
				 serial = ++that._serial;
				 for (i = index; i < indexLim; ++i) {
				     serials[i] = serial;
				 }
				 next();
				 if (err) {
				     callback(err);
				     return;
				 }
				 callback(null, true, serial);
			     });

    }
    var wLock = [ index, indexLim, actionCallback ];
    const readLocks = this._rLocks;
    var readBlocked = false;
    for (i = index; i < indexLim; ++i) {
	var cur = readLocks[i];
	if (cur > 0) {
	    // Tag those read locks which are blocking this write
	    readLocks[i] = -cur;
	    readBlocked = true;
	} else if (cur != null) {
	    readBlocked = true;
	}
    }
    const writeLocks = this._wLocks;
    writeLocks.push(wLock);
    if (!readBlocked && writeLocks.length == 1) {
	this._checkWrites();
    }
}

// callback(err, didWrite, serial)
BlockFile.prototype.write = function(index, buffer, callback) {
    this.writeUnlessChanged(index, buffer, null, callback);
}

BlockFile.prototype._checkWrites = function() {
    const writeLocks = this._wLocks;
    const readLocks = this._rLocks;
    const that = this;
    while (writeLocks.length > 0) {
	var firstWrite = writeLocks[0];
	if (firstWrite[2] == null) {
	    // Write in progress
	    return;
	}
	var index = firstWrite[0];
	var indexLim = firstWrite[1];
	for (var i = index; i < indexLim; ++i) {
	    if (readLocks[i]) {
		// Still blocked;
		return;
	    }
	}
	var action = firstWrite[2];
	firstWrite[2] = null;
	action(null, function() {
	    if (firstWrite != writeLocks[0]) {
		util.log("Strange, completed write not at front");
		return;
	    }
	    writeLocks.shift();
	    that._checkWrites();
	    for (var i = 3; i < firstWrite.length; ++i) {
		firstWrite[i]();
	    }
	});
    }
}

exports.BlockFile = BlockFile;
