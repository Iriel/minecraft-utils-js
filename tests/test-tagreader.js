// Tests for the tagreader code..


var fs = require('fs');
var zlib = require('zlib');
var path = require('path');

var tagio = require('../minecraft-tagio');
var moduleDir = path.dirname(module.filename);
var testFile = path.resolve(moduleDir, 'data', 'tagreader-input1.dat');

function destroyStream(stream) {
    if (stream) {
	try {
	    stream.destroy();
	} catch (e) {
	    console.error("Stream destroy failed: " + e);
	    if (e.stack) {
		console.error(e.stack);
	    }
	}
    }
}

function createFileTagReader(filename, callback) {
    fs.open(filename, "r", function(err, fd) {
	if (err) {
	    callback(err);
	    return;
	}
	var rStream = fs.createReadStream(null, {fd : fd});
	var tagReader = rStream.pipe(zlib.createGunzip()).pipe(new tagio.TagReader());
	callback(null, tagReader, rStream);;
    });
}


exports.test1 = function(test) {
    createFileTagReader(testFile, function(err, tagReader, rStream) {
	test.ifError(err);

	tagReader.readObject(function(err, obj) {
	    if (err) {
		destroyStream(rStream);
		test.ifError(err);
		return;
	    }

	    test.notEqual(obj, null, "Second read must return null");
	    
	    tagReader.readObject(function(err, secondObj) {
		if (err) {
		    destroyStream(rStream);
		    test.ifError(err);
		    return;
		}

		test.equal(secondObj, null, "Second read must return null");
		rStream.destroy();

		test.equal(obj.XpLevel, 27);
		test.equal(obj.EnderItems[2].tag.ench[0].lvl, 2);
		test.equal(obj.EnderItems[2].tag.ench[1].lvl, 4);
		test.done();
	    });
	});

    });

}

