// Minecraft stuff - Produce an ascii map of chunks..
// Daniel Stephens (iriel@iriel.org), Jan 2013

var util = require('util');
var minecraft = require('./minecraft');

var world =  new minecraft.Dimension('testdata/NextEdenReal/CogRail3/');
var nether = new minecraft.Dimension('testdata/NextEdenReal/CogRail3/DIM-1');
var theend = new minecraft.Dimension('testdata/NextEdenReal/CogRail3/DIM1');

function isUndefined(x) {
    return (x == null) && (x !== null);
}

var showResult = function(err, result) {
    if (err) {
	util.error("Failed: " + JSON.stringify(err));
	return;
    }
    if (!isUndefined(result)) {
	console.log(JSON.stringify(result, null, "  "));
    }
}


var countTileEntities = function(dimension, callback) {
    var result = {};
    var chunkIterFunc = function(chunk, next) {
	result.chunks = (result.chunks || 0) + 1;
	var tileEntities = chunk._tileEntities;
	for (var i = 0; i < tileEntities.length; ++i) {
	    var entity = tileEntities[i];
	    var id = entity.id;
	    result[id] = (result[id] || 0) + 1;
	    if (id == 'Chest') {
		//util.log(JSON.stringify(entity));
		var count = 0;
		var stacks = 0;
		var items = entity.Items;
		for (var j = 0; j < items.length; ++j) {
		    var item = items[j];
		    if (item.Count > 0) {
			count += item.Count;
			stacks++;
			var itemid = "Chest=" + item.id;
			result[itemid] = (result[itemid] || 0) + item.Count;
		    }
		}

		result['Chest+' + count] = (result['Chest+' + count] || 0) + 1; 
		result['Chest/' + stacks] = (result['Chest/' + stacks] || 0) + 1; 
	    }
	    id = entity.id + "@" + (Math.floor(entity.x / 500) * 500) + "x" + (Math.floor(entity.z / 500) * 500);
	    result[id] = (result[id] || 0) + 1;
	}
	    /*	var entities = chunk._entities;
	for (var i = 0; i < entities.length; ++i) {
	    var entity = entities[i];
	    var id = entity.id;
	    result[id] = (result[id] || 0) + 1;
	} */
	next();
    }
    var regionIterFunc = function(region, next) {
	result.regions = (result.regions || 0) + 1;

	region.forAllChunks(chunkIterFunc,
			    function(err) {
				region.close();
				next(err);
			    });
    }

    dimension.forAllRegions2(regionIterFunc,
			    function(err) {
				if (err) {
				    callback(err);
				    return;
				}
				callback(null, result);
			    }, 10);
}

function forAllDimensionChunks(dimension, iterator, callback, limit) {
    var regionIterFunc = function(region, next) {
	region.forAllChunks(iterator,
			    function(err) {
				region.close();
				next(err);
			    });
    }

    dimension.forAllRegions2(regionIterFunc,
			    function(err) {
				if (err) {
				    callback(err);
				    return;
				}
				callback(null);
			    }, limit);
}

function countBlocks(dimension, callback) {
    var result = {};
    function chunkCallback(chunk, next) {
	var sections = chunk._level.Sections;
	var myBlocks = new Array(256);
	for (var i = 0; i < sections.length; ++i) {
	    var section = sections[i];
	    var blocks = section.Blocks;
	    for (var j = 0; j < blocks.length; ++j) {
		var id = blocks[j] & 0x0ff;
		myBlocks[id] = (myBlocks[id] || 0) + 1;
	    }
	}
	for (var id = 0; id < 256; ++id) {
	    var cnt = myBlocks[id];
	    if (cnt) {
		var data = result[id];
		if (!data) {
		    data = { id: id, count: 0, chunks : 0 }
		    result[id] = data;
		}
		data.count += cnt;
		data.chunks++;
	    }
	}
	next();
    }

    function byFrequency(a, b) {
	if (a.chunks > b.chunks) { return -1 }
	if (a.chunks < b.chunks) { return 1 }

	if (a.count > b.count) { return -1 }
	if (a.count < b.count) { return 1 }

	if (a.id > b.id) { return 1 }
	if (a.id < b.id) { return -1 }
	return 0;
    }

    function finalCallback(err) {
	if (err) { callback(err); return; }

	var keys = Object.keys(result);
	var resList = [];
	for (var i = 0; i < keys.length; ++i) {
	    var id = keys[i];
	    resList[i] = result[id]
	}
	resList.sort(byFrequency);
	callback(null, resList);
    }
    forAllDimensionChunks(dimension, chunkCallback, finalCallback, 10);
}

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

var MANMADE_NETHER_BLOCKS = {
    1 : "Smooth Stone",
    2 : "Grass",
    3 : "Dirt",
    4 : "Cobblestone",

    12 : "Sand",
    17 : "Wood",
    18 : "Leaves",

    20 : "Glass",
    27 : "Powered Rail",

    37 : "Yellow Flower",
    38 : "Red Flower",

    43 : "Double Slabs",
    44 : "Stone Slab",
    49 : "Obsidian",

    50 : "Torch",
    54 : "Chest",

    58 : "Crafting Table",

    61 : "Furnace",
    62 : "Furnace (Lit)",
    63 : "Sign (Block)",
    64 : "Wooden Door",
    65 : "Ladder",

    66 : "Rail",
    67 : "Cobblestone Stairs",
    68 : "Sign (Wall)",
    69 : "Lever",

    75 : "Redstone Torch (off)",
    76 : "Redstone Torch (on)",
    77 : "Button (Stone)",

    80 : "Snow Block",
    85 : "Fence",

    90 : "Nether Portal",
    98 : "Stone Brick",

    101 : "Iron Bars",
    102 : "Glass Pane",
    109 : "Stone Brick Stairs",

    130 : "Ender Chest",
}

function netherBlockCheck(err, blocks) {
    if (err) {
	util.log("FAILED: " + err);
	util.log(err.stack);
	return;
    }
    for (var i = 0; i < blocks.length; ++i) {
	var block = blocks[i];
	var natural = NATURAL_NETHER_BLOCKS[block.id];
	var manmade = MANMADE_NETHER_BLOCKS[block.id];
	if (manmade) {
	    console.log(">>>\t" + block.id + "\t" + block.chunks + "\t" + block.count + ":\t" + manmade);
	} else if (natural) {
	    console.log(" -\t" + block.id + "\t" + block.chunks + "\t" + block.count + ":\t" + natural);
	} else {
	    console.log("???\t" + block.id + "\t" + block.chunks + "\t" + block.count);
	}
    }
}

function findNaturalChunks(dimension, naturalBlocks, callback) {
    var result = {};
    function chunkCallback(chunk, next) {
	var x = chunk._level.xPos;
	var z = chunk._level.zPos;
	var sections = chunk._level.Sections;
	for (var i = 0; i < sections.length; ++i) {
	    var section = sections[i];
	    var blocks = section.Blocks;
	    for (var j = 0; j < blocks.length; ++j) {
		var id = blocks[j] & 0x0ff;
		if (!naturalBlocks[id]) {
		    console.log("KEEP [" + x + "," + z + "]");
		    next();
		    return;
		}
	    }
	}
	var rx = Math.floor(x / 32);
	var rz = Math.floor(z / 32);
	var cx = x - (rx * 32);
	var cz = z - (rz * 32);

	var rFile = "r." + rx + "." + rz + ".mca";
	var rOfs = cx + cz * 32;

	console.log("REMOVE [" + x + "," + z + "]\t" + rFile
+ "\t" + rOfs);

	var fResult = result[rFile];
	if (fResult == null) {
	    fResult = [];
	    result[rFile] = fResult;
	}
	fResult.push(rOfs);

	next();
    }

    forAllDimensionChunks(dimension, chunkCallback, 
			  function(err) {
			      if (err) { callback(err); return; }
			      callback(null, result);
			  }, 10);
}

//countTileEntities(world, showResult);
//countTileEntities(nether, showResult);
//countTileEntities(theend, showResult);
/*
var repl = require('repl').start("Node> ");

repl.context.world = world;
repl.context.nether = nether;
repl.context.theend = theend;

repl.context.showResult = showResult;
repl.context.countTileEntities = countTileEntities;
repl.context.forAllDimensionChunks = forAllDimensionChunks;
repl.context.countBlocks = countBlocks;
*/

/*findNaturalChunks(nether, NATURAL_NETHER_BLOCKS, function(err, result) {
    if (err) {
	util.log("FAILED: " + err);
	util.log(err.stack);
	return;
    }
    console.log(JSON.stringify(result));
    countBlocks(nether, netherBlockCheck);
});
*/

//countBlocks(nether, netherBlockCheck);
//countBlocks(world, netherBlockCheck);
//countBlocks(theend, netherBlockCheck);

const NORMAL_CHUNK = '==';

var Grid = function(xSize, zSize) {
    this.xSize = xSize;
    this.zSize = zSize;
    var buffer = new Buffer(xSize * zSize);
    buffer.fill(0);

    this.get = function(x, z) {
	if (x < 0 || x >= xSize) { return 0; }
	if (z < 0 || z >= zSize) { return 0; }
	return buffer[x + z * xSize];
    }

    this.set = function(x, z, v) {
	if (x < 0 || x >= xSize) { return; }
	if (z < 0 || z >= zSize) { return; }
	buffer[x + z * xSize] = v;
    }

    this.add = function(x, z, v) {
	if (x < 0 || x >= xSize) { return; }
	if (z < 0 || z >= zSize) { return; }
	buffer[x + z * xSize] += v;
    }

    this.setIfLess = function(x, z, v) {
	if (x < 0 || x >= xSize) { return; }
	if (z < 0 || z >= zSize) { return; }
	var ofs = x + z * xSize;
	if (buffer[ofs] < v) { buffer[ofs] = v; }
    }
}

function scoreNeighbors(data, maxDist) {
    var xSize = data.xSize;
    var zSize = data.zSize;
    var nMap = new Grid(xSize, zSize);
    var minDist = -maxDist;

    for (var z = 0; z < zSize; ++z) {
	for (var x = 0; x < xSize; ++x) {
	    var best = maxDist;

	    for (var zo = -best; zo <= best; ++zo) {
		var zDist = Math.abs(zo);
		for (var xo = -best; xo <= best && zDist <= best; ++xo) {
		    var xDist = Math.abs(xo);
		    if (xDist <= best) {
			var score = Math.max(xDist, zDist);
			if (data.get(x + xo, z + zo) < 100) {
			    // Miss!
			    best = score - 1;
			}
		    }
		}
	    }

	    nMap.set(x, z, best);
	}
    }
    return nMap;
}

function createMap(dimension, callback) {
    var mapData;
    var minChunkX, minChunkZ;
    var xSize, zSize;

    var regionCallback = function(region, next) {
	region.getIndex(function(err, index) {
	    if (err) {
		next(err);
		return;
	    }
	    var xOfs = region.regionX * 32 - minChunkX;
	    var zOfs = region.regionZ * 32 - minChunkZ;

	    var zPos = zOfs;
	    for (var z = 0; z < region.zSize; ++z, ++zPos) {
		var xPos = xOfs;
		for (var x = 0; x < region.xSize; ++x, ++xPos) {
		    if (index.hasChunk(x, z)) {
			mapData.set(xPos, zPos, 100);
		    } else {
			mapData.set(xPos, zPos, 1);
		    }
		}
	    }
	    region.close();
	    next();
	});
    }

    var doneCallback = function(err, result) {
	if (err) { callback(err); return; }
	var neighbors = scoreNeighbors(mapData, 10);
	var line = new Array(xSize);
	var chunkCount = 0;
	var innerCount = 0;
	for (var z = 0; z < zSize; ++z) {
	    for (var x = 0; x < xSize; ++x) {
		var val = mapData.get(x, z);
		var sym = '  ';
		if (val == 100) {
		    ++chunkCount;
		    if (neighbors.get(x, z) > 9) {
			++innerCount;
			sym = '[]';
		    } else {
			sym = '==';
		    }
		} else if (val == 1) {
		    sym = '..';
		}
		line[x] = sym;
	    }
	    console.log("".concat.apply("", line));
	}
	callback(null, { chunks : chunkCount, innerChunks : innerCount });
    }

    dimension.getIndex(function(err, index) {
	if (err) {
	    callback(err);
	    return;
	}
	minChunkX = index.minX * 32;
	minChunkZ = index.minZ * 32;

	xSize = (index.maxX - index.minX + 1) * 32;
	zSize = (index.maxZ - index.minZ + 1) * 32;
	
	mapData = new Grid(xSize, zSize);

	dimension.forAllRegions2(regionCallback, doneCallback);
    });
}

//createMap(world, showResult);
createMap(nether, showResult);
