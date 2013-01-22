#!/usr/bin/env node
// Quick sanity check for TAG IO

var util = require('util');
var tagio = require('./minecraft-tagio');

var fs = require('fs');
var zlib = require('zlib');

var filenames = [];
for (var i = 2; i < process.argv.length; ++i) {
    filenames.push(process.argv[i]);
}

if (filenames.length == 0) {
    console.error("Usage: " + process.argv[1] + " [filename(s)...]");
    return;
}


var nextFile = function() {
    while (true) {
	var filename = filenames.shift();
	if (!filename) { return; }
	var fd;
	try {
	    fd = fs.openSync(filename, "r");
	} catch (e) {
	    console.error("Unable to open '" + filename + "': " + e);
	    if (e.stack) {
		console.error(e.stack);
	    }
	    continue;
	}

	var rStream = fs.createReadStream(null, {fd : fd});
	var tagReader = rStream.pipe(zlib.createGunzip()).pipe(new tagio.TagReader());

	var roCallback = function(err, obj, entry) {
	    if (err) {
		try {
		    rStream.destroy();
		} catch (e) {
		    console.error("Close failed: " + e);
		    if (e.stack) {
			console.error(e.stack);
		    }
		}
		console.error(err);
		if (err.stack) {
		    console.error(err.stack);
		}
		nextFile();
		return;
	    }
	    if (obj == null) {
		try {
		    rStream.destroy();
		} catch (e) {
		    console.error("Close failed: " + e);
		    if (e.stack) {
			console.error(e.stack);
		    }
		}
		nextFile();
		return;
	    }
	    console.log(JSON.stringify(obj, null, '  '));
	    tagReader.readObject(roCallback);
	}

	tagReader.readObject(roCallback);
	return;
    }
}

nextFile();
