// Minecraft Library of Stuff
// Daniel Stephens (iriel@iriel.org), Jan 2013

function addExportsFrom(otherModule) {
    var keys = Object.keys(otherModule);
    for (var i = 0; i < keys.length; ++i) {
	var key = keys[i];
	exports[key] = otherModule[key];
    }
}

addExportsFrom(require('./minecraft-tagio'));

addExportsFrom(require('./minecraft-chunk'));
addExportsFrom(require('./minecraft-region'));
addExportsFrom(require('./minecraft-dimension'));


