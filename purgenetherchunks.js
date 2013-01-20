#!/usr/bin/env node

var util = require('util');
var region = require('./minecraft-region');

var NATURAL_NETHER_BLOCKS = {
    0 : "Air",

    7 : "Bedrock",

    10 : "Lava Source",
    11 : "Lava",
    13 : "Gravel",

    39 : "Mushroom (brown)",
    40 : "Mushroom (red)",

    51 : "Fire",
    52 : "Monster Spawner",

    87 : "Netherrack",
    88 : "Soul Sand",
    89 : "Glowstone",

    112 : "Nether Brick",
    113 : "Nether Brick Fence",
    114 : "Nether Brick Stairs",
    115 : "Nether Wart",
}

function findNaturalChunks(region, naturalBlocks, callback) {
    var chunks = 0;
    var removed = 0;

    function chunkCallback(chunk, next) {
	++chunks;
	var x = chunk._level.xPos;
	var z = chunk._level.zPos;
	var sections = chunk._level.Sections;
	for (var i = 0; i < sections.length; ++i) {
	    var section = sections[i];
	    var blocks = section.Blocks;
	    for (var j = 0; j < blocks.length; ++j) {
		var id = blocks.readInt8(j) & 0x0ff;
		if (!naturalBlocks[id]) {
		    //console.log("KEEP [" + x + "," + z + "]");
		    next();
		    return;
		}
	    }
	}
	var rx = Math.floor(x / 32);
	var rz = Math.floor(z / 32);
	var cx = x - (rx * 32);
	var cz = z - (rz * 32);

	region.writeRawChunkData(cx + cz * 32, null,
				 function(err, wrote) {
				     if (err) {
					 next(err);
					 return;
				     }
				     if (wrote) {
					 ++removed;
					 // console.log("Removed [" + x + "," + z + "]");
				     } else {
					 console.log("Omitted [" + x + "," + z + "]");
				     }
				     next();
				 });
    }

    region.forAllChunks(chunkCallback, 
			function(err) {
			    try {
				region.close();
			    } catch (e) {
				util.log("Close failed: " + e);
			    }
			    if (err) {
				callback(err);
			    } else {
				callback(null, region, "Removed " +
					 removed + " of " + chunks
					 + " chunk(s)");
			    }
			});;
}


for (var i = 2; i < process.argv.length; ++i) {
    var path = process.argv[i];
    console.log("Processing " + path);

    (function (path) {
	var purgeRegion = new region.Region(path, { writable : true });
	findNaturalChunks(purgeRegion, NATURAL_NETHER_BLOCKS,
			  function(err, region, status) {
			      if (err) {
				  throw new Error("Failed: " + err);
			      }
			      console.log("[" + region.path + "] " + status);
			  });
    })(path);
}

