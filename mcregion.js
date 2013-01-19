// Minecraft stuff
// Daniel Stephens (iriel@iriel.org), Jan 2013

var fs = require('fs');
var util = require('util');
var region = require('./minecraft-region');

var world =  new region.Dimension('testdata/NextEdenReal/CogRail3/');
var nether = new region.Dimension('testdata/NextEdenReal/CogRail3/DIM-1');
var theend = new region.Dimension('testdata/NextEdenReal/CogRail3/DIM1');

var showResult = function(err, result) {
    if (err) {
	util.error("Failed: " + JSON.stringify(err));
	return;
    }
    console.log(JSON.stringify(result, null, "  "));
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

//countTileEntities(world, showResult);
countTileEntities(nether, showResult);
//countTileEntities(theend, showResult);

/*
var repl = require('repl').start("Node> ");

repl.context.notifyPending = notifyPending;

repl.context.world = world;
repl.context.nether = nether;
repl.context.theend = theend;

repl.context.showResult = showResult;
repl.context.countTileEntities = countTileEntities;
*/