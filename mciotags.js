// Minecraft stuff
// Daniel Stephens (iriel@iriel.org), Jan 2013

var util = require('util');
var tagio = require('./minecraft-tagio');

var fs = require('fs');
var zlib = require('zlib');

var fd = fs.openSync('testdata/NextEdenReal/CogRail3/players/Yssaril.dat', 'r');
var tagReader = fs.createReadStream(null, {fd:fd}).pipe(zlib.createGunzip()).pipe(new tagio.TagReader());

var booleanConverter = {
    canConvert : function(type) {
	return type == tagio.TAG_TYPE_BYTE;
    },
    onGet : function(val, type) {
	if (val == 0) { return false; }
	if (val == 1) { return true; }
	return val;
    },
    onSet : function(val, type) {
	if (val == true) { return 1; }
	if (val == false) { return 0; }
	return val;
    }
}

var enchantConverter = {
    canConvert : function(type) {
	return type == tagio.TAG_TYPE_SHORT;
    },
    onGet : function(val, type) {
	var mapped = this[val];
	if (mapped) { return mapped; }
	return val;
    },

    0 : 'Protection',
    1 : 'Fire Protection',
    2 : 'Feather Falling', 
    3 : 'Blast Protection',
    4 : 'Projectile Protection',
    5 : 'Respiration',
    6 : 'Aqua Affinity',
    7 : 'Thorns',

    16 : 'Sharpness',
    17 : 'Smite',
    18 : 'Bane of Arthropods',
    19 : 'Knockback',
    20 : 'Fire Aspect',
    21 : 'Looting',

    32 : 'Efficiency',
    33 : 'Silk Touch',
    34 : 'Unbreaking',
    35 : 'Fortune',

    48 : 'Power',
    49 : 'Punch',
    50 : 'Flame',
    51 : 'Infinity'
}

var itemIdConverter = {
    canConvert : function(type) {
	return type == tagio.TAG_TYPE_SHORT;
    },
    onGet : function(val, type) {
	var mapped = this[val];
	if (mapped) { return mapped; }
	return val;
    },

    262 : 'Arrow',
    276 : 'Diamond Sword',
    388 : 'Emerald'
}

var enchantMapping = {
    '*' : {
	'id' : enchantConverter
    }
}

var playerMapping = {
    'OnGround' : booleanConverter,
    'CanPickUpLoot' : booleanConverter,
    'SpawnForced' : booleanConverter,
    'PersistenceRequired' : booleanConverter,
    'EnderItems' : {
	'*' : {
	    'id' : itemIdConverter,
	    'tag' : {
		'ench' : enchantMapping
	    }
	}
    },
    'Inventory' : {
	'*' : {
	    'id' : itemIdConverter,
	    'tag' : {
		'ench' : enchantMapping
	    }
	}
    },
    'abilities' : {
	'flying' : booleanConverter,
	'instabuild' : booleanConverter,
	'mayfly' : booleanConverter,
	'invulnerable' : booleanConverter,
	'mayBuild' : booleanConverter
    }
}

var mapStructure = function(spec, data) {
    for (var key in spec) {
	var keyDataType = data.getType(key);
	if (!keyDataType) { continue; }
	var keySpec = spec[key];

	if (keySpec.canConvert) {
	    //util.log("Checking mapping for " + key + " " + JSON.stringify(keyDataType));
	    if (keySpec.canConvert(keyDataType)) {
		data.getEntry(key)[2] = keySpec;
	    }
	} else if (keyDataType == tagio.TAG_TYPE_OBJECT.getListType()) {
	    //util.log("Descending list " + key);
	    var entrySpec = keySpec['*'];
	    if (!entrySpec) { continue; }
	    var list = data[key];

	    for (var i = 0; i < list.length; ++i) {
		mapStructure(entrySpec, list[i]);
	    }
	} else if (keyDataType == tagio.TAG_TYPE_OBJECT) {
	    //util.log("Descending into " + key);
	    mapStructure(keySpec, data[key]);
	    //util.log("Back from " + key);
	}
    }
}

tagReader.readObject(function(err, obj, name) {
    if (err) {
	util.log("Failed to read value: " + JSON.stringify(err));
	return;
    }
    mapStructure(playerMapping, obj);
    console.log(JSON.stringify(obj, null, '  '));
});

tagReader.readValue(function(err, value) {
    if (err) {
	util.log("Failed to read value: " + JSON.stringify(err));
	return;
    }
    console.log(util.inspect(value, false, null, true));
});

