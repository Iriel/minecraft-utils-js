// Minecraft stuff - Chunk
// Daniel Stephens (iriel@iriel.org), Jan 2013


var internal = require('./minecraft-internal');
const notifyPending = internal.notifyPending;

// ---------------------------------------------------------------------------

var Chunk  = function(taggedObj, saveTime) {
    if (!taggedObj.Level) {
	throw new Error("Chunk object without level!");
    }
    this._obj = taggedObj;
    this._saveTime = saveTime;

    var level = taggedObj.Level;
    this._level = level;
    this._entities = level.Entities;
    this._biomes = level.Biomes;
    this._tileEntities = level.TileEntities;
    this._heightMap = level.HeightMap;

    /*util.log('New Chunk [' + this.getXPos() + "," + this.getZPos() + "] time="
	     + new Date(saveTime * 1000)); */
}

Chunk.prototype.getXPos = function() { return this._level.xPos; }

Chunk.prototype.getZPos = function() { return this._level.zPos; }

Chunk.prototype.summarize = function() {
    var tileEntities = this._tileEntities;
    for (var i = 0; i < tileEntities.length; ++i) {
	var ent = tileEntities[i];
	var desc = i + " [" + ent.x + "," + ent.y + "," + ent.z
		    + "] " + ent.id;

	if (ent.id == 'Sign') {
	    desc = desc + " "
		+ ent.Text1 + "/" + ent.Text2 + "/" + ent.Text3 + "/" + ent.Text4;
	} else if (ent.id == 'Chest') {
	    desc = desc + " Items: " + ent.Items.length;
	}

	console.log(desc);
    }
}

exports.Chunk = Chunk;

