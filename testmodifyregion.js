// Test code for region changes

var util = require('util');
var region = require('./minecraft-region');
var async = require('async');


var region = new region.Region('testdata/testregion.mca', { writable : true });
var regionIndex;
var regionEntry;
var regionData;

util.log("Queuing series...");
async.series(
    [
	function(callback) {
	    region.getIndex(function(err, index, serial) {
		if (err) { callback(err); return; }
		util.log("IndexSerial: " + index.serial 
			 + "; FileSerial " + serial);

		for (var i = 0; i < 32*32; ++i) {
		    var entry = index.get(i);
		    if (entry[1]) {
			regionEntry = entry;
			regionIndex = i;
			region.getRawChunkData(i, 
					       function(err, data,
							serial, fileSerial) {
						   if (err) { callback(err); return; }
						   util.log("Chunk data: " + serial + " " + fileSerial);
						   regionData = data;
						   callback(null, "Got region " + regionIndex);
					       });
			return;
		    }
		}
		callback(new Error("Unable to find a region"));
	    });
	},

	function(callback) {
	    region.writeRawChunkData(regionIndex, null, callback);
	},

    ],
    function(err, results) {
	util.log("Series complete");
	util.log(JSON.stringify(regionEntry));
	try {
	    region.close();
	} catch (e) {
	    util.log("Failed to close region: " + e);
	}
	if (err) {
	    util.log("Failed" + err);
	    if (err.stack) { util.log(err.stack); }
	} else {
	    util.log("Complete: " + JSON.stringify(results, null, '  '));
	}
    }
);

