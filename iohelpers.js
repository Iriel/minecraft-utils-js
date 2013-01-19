// Minecraft stuff - More general IO Helpers
//
// Would be awesome if these exist somewhere standard (or if there's a
// better way).
//
// Daniel Stephens (iriel@iriel.org)

var fs = require('fs');

// readFully(fd, ofs, buffer [,pos, [,toRead]] callback)
//
// Read all of the required data into a buffer
//
//   fd - The file descriptor to read from
//   ofs - The location of the start of the READ in the file, can be
//         null for the current location
//   buffer - the buffer to read into
//   pos - the location in the buffer to start reading to (defaults to 0)
//   toRead - the number of bytes to read (defaults to the rest of the buffer)
//   callback(err, buffer) - Invoked when the read is completex
function readFully(fd, ofs, buffer, pos, toRead, callback) {
    if (toRead == null) {
	callback = pos;
	pos = 0;
	toRead = buffer.length;
    } else if (callback == null) { 
	callback = toRead;
	toRead = buffer.length - pos;
    }

    // Adjust offset to match the BUFFER start
    if (ofs != null) {
	ofs -= pos;
    }
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
	    callback(new Error("EOF during readFully"));
	    return;
	}
	toGet -= bytesRead;
	pos += bytesRead;
	if (toGet < 0) {
	    callback(new Error("Assertion failed; Got more data than requested"));
	    return;
	}
	
	if (toGet > 0) {
	    var readOfs = (ofs == null) ? null : (ofs + pos);
	    fs.read(fd, buffer, pos, toGet, readOfs, readCallback);
	} else {
	    callback(null, buffer);
	}
    }
    var readOfs = (ofs == null) ? null : (ofs + pos);
    fs.read(fd, buffer, pos, toGet, readOfs, readCallback);
}

exports.readFully = readFully;
