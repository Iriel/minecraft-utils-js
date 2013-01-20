var fs = require('fs');
var blockfile = require('./blockfile');
var async = require('async');
var util = require('util');

try {
    fs.unlinkSync('testfile.dat');
} catch (e) {
    // Ignore
}
var fd = fs.openSync('testfile.dat', 'wx+');

var file = new blockfile.BlockFile(fd, {
    blockSize : 1024, writable : true
});

util.log("Queuing series...");
async.series(
    [
	function(callback) {
	    file.read(0, 1, function(err, buf, serial, fileSerial) {
		if (err) {
		    callback(null, 'Success: Error as expected: ' + err);
		    return;
		}
		callback(new Error("Expected failure, got buf: " + buf
				   + "; serial: " + serial
				   + "; fileSerial: " + fileSerial));
	    });
	},

	function(callback) {
	    var buf = new Buffer(2048);
	    buf.fill('*');
	    file.write(0, buf, function(err, wrote, serial) {
		if (err) {
		    callback(err);
		    return;
		}
		if (!wrote) {
		    callback(new Error("Failed: Did not write; serial: " + serial));
		} else {
		    callback(null, "Success: wrote: " + wrote + " serial: " + serial);
		}
	    });
	},

	function(callback) {
	    file.read(1, 1, function(err, buf, serial, fileSerial) {
		if (err) {
		    callback(err);
		    return;
		}
		callback(null, "got buf: " + buf + "; serial: " + serial
				   + "; fileSerial: " + fileSerial);
	    });
	},

	function(callback) {
	    var buf = new Buffer(1024);
	    buf.fill('-');
	    file.write(0, buf, function(err, wrote, serial) {
		if (err) {
		    callback(err);
		    return;
		}
		if (!wrote) {
		    callback(new Error("Failed: Did not write; serial: " + serial));
		} else {
		    callback(null, "Success: wrote: " + wrote + " serial: " + serial);
		}
	    });
	},

	function(callback) {
	    file.read(0, 2, function(err, buf, serial, fileSerial) {
		if (err) {
		    callback(err);
		    return;
		}
		callback(null, "got buf: " + buf + "; serial: " + serial
				   + "; fileSerial: " + fileSerial);
	    });
	},

	function(callback) {
	    file.read(1, 1, function(err, buf, serial, fileSerial) {
		if (err) {
		    callback(err);
		    return;
		}
		callback(null, "got buf: " + buf + "; serial: " + serial
				   + "; fileSerial: " + fileSerial);
	    });
	},

	function(callback) {
	    var buf = new Buffer(1024);
	    buf.fill('X');
	    file.writeUnlessChanged(0, buf, 2, function(err, wrote, serial) {
		if (err) {
		    callback(err);
		    return;
		}
		if (wrote) {
		    callback(new Error("Failed; Was not supposed to write"));
		} else {
		    callback(null, "Success: wrote: " + wrote + " serial: " + serial);
		}
	    });
	},

	function(callback) {
	    var buf = new Buffer(1024);
	    buf.fill('X');
	    file.writeUnlessChanged(1, buf, 2, function(err, wrote, serial) {
		if (err) {
		    callback(err);
		    return;
		}
		if (!wrote) {
		    callback(new Error("Failed; Was supposed to write"));
		} else {
		    callback(null, "Success: wrote: " + wrote + " serial: " + serial);
		}
	    });
	},

	function(callback) {
	    file.read(0, 2, function(err, buf, serial) {
		if (err) {
		    callback(err);
		    return;
		}
		callback(null, "got buf: " + buf + "; serial: " + serial);
	    });
	},

    ],
    function(err, results) {
	util.log("Series complete");
	util.log(JSON.stringify(file));
	try {
	    fs.close(fd);
	} catch (e) {
	    util.log("Failed to close FD: " + e);
	}
	if (err) {
	    util.log("Failed" + err);
	    if (err.stack) { util.log(err.stack); }
	} else {
	    util.log("Complete: " + JSON.stringify(results, null, '  '));
	}
    }
);

