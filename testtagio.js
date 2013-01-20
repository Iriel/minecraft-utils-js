// Quick sanity check for TAG IO

var util = require('util');
var tagio = require('./minecraft-tagio');

var fs = require('fs');
var zlib = require('zlib');

var fd = fs.openSync('testdata/NextEdenReal/CogRail3/players/Yssaril.dat', 'r');
var tagReader = fs.createReadStream(null, {fd:fd}).pipe(zlib.createGunzip()).pipe(new tagio.TagReader());


tagReader.readObject(function(err, obj, name) {
    if (err) {
	util.log("Failed to read value: " + JSON.stringify(err));
	return;
    }
    console.log(JSON.stringify(obj, null, '  '));
});

