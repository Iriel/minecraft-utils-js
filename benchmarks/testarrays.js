#!/usr/bin/env node

const TEST_CONFIGURATIONS = {
    newArray : {
	create: function(x, y) { return [ x[0], x[1], y ]; },
	consume: function(x) { return x[1]; }
    },

    expandArray : {
	create: function(x, y) { x[2] = y; return x; },
	consume: function(x) { return x[1]; }
    },

    nestArray : {
	create : function(x, y) { return [ y, x ]; },
	consume: function(x) { return x[1][1]; }
    },

    fullObject : {
	create : function(x, y) { return { id: y, type: x[0], value: x[1] }; },
	consume : function(x) { return x.value; }
    },

    nestObject : {
	create : function(x, y) { return { id: y, data: x }; },
	consume : function(x) { return x.data[1]; }
    },

    nullFuncs : {
	create : function() { },
	consume : function() { return 0; }
    },
}


/*function makeArray(x, y) {
//    return [ x[0], x[1], y ]; // 5.486s
//    x[2] = y; return x; // 9.205s
//    return [y, x]; // 6.663s
//    return {id:y, val:x}; // 4.952s
    return {id:y, type:x[0], val:x[1]}; // OBJECT 6.041s
} */

/*function getValue(x) {
//    return x[1]; 0.742s
//    return x[1]; // 1.411s
//    return x[1][1]; // 0.941s
//    return x.val[1]; // 0.773s
    return x.val; // 0.501s // 
}*/

var configId = process.argv[2];
if (!configId) {
    var keys = Object.keys(TEST_CONFIGURATIONS);
    for (var i = 0; i < keys.length; ++i) {
	console.log(keys[i]);
    }
    return;
}
    

var config = TEST_CONFIGURATIONS[configId];
if (config == null) {
    throw new Error("Undefined test configuration '" + configId + "'");
}

const makeArray = config.create;
const getValue = config.consume;

var times = {
    setup : [],
    consume : [],
};

const ENTRY_COUNT = 10000;
const BUILD_COUNT = 200;

const TEST_RUNS = 10;
const CONSUME_RUNS = 10;


var results = [];
for (var k = 0; k < TEST_RUNS; ++k) {
    console.log("Iteration " + k);

    // SETUP
    var start = Date.now();
    var n = 0;
    for (var j = 0; j < BUILD_COUNT; ++j) {
	var result = results[j];
	if (result == null) {
	    result = [];
	    results[j] = result;
	}
	var total = 0;
	for (var i = 0; i < ENTRY_COUNT; ++i) {
	    ++n;
	    result[i] = makeArray([ 'foo', n ] , i);
	}
	//console.log(result.length);
    }
    var end = Date.now();
    var elapsed = end - start;
    console.log("SETUP Elapsed: " + elapsed);
    times.setup.push(elapsed);

    start = Date.now();
    for (var kk = 0; kk < CONSUME_RUNS; ++kk) {
	var total = 0;
	for (var j = 0; j < BUILD_COUNT; ++j) {
	    var result = results[j];
	    var l = result.length;
	    for (var i = 0; i < l; ++i) {
		total += getValue(result[i]);
	    }
	}
	console.log(kk + "\t" + total);
    }
    end = Date.now();
    elapsed = end - start;
    console.log("CONSUME Elapsed: " + elapsed);
    times.consume.push(elapsed);
}

function mean(data) {
    var sum = 0;
    for (var i = 0; i < data.length; ++i) {
	sum += data[i];
    }
    return sum / data.length;
}

function stddev(data) {
    var dataMean = mean(data);
    var sumDevs = 0;
    for (var i = 0; i < data.length; ++i) {
	var dev = data[i] - dataMean;
	sumDevs = dev * dev;
    }
    return Math.sqrt(sumDevs / (data.length - 1));
}

function showResult(label, data) {
    data.splice(0, 1); // Discard first iteration
    var result = label;
    var resData =  JSON.stringify(data);
    var allMean = mean(data).toFixed(1);
    var allStdDev = stddev(data).toFixed(2);
    result += ('\t' + allMean);
    result += ('\t' + allStdDev);
    data.sort();
    data.splice(0, 1);
    data.splice(data.length -1, 1);
    var innerMean = mean(data).toFixed(1);
    var innerStdDev = stddev(data).toFixed(2);
    result += ('\t' + innerMean);
    result += ('\t' + innerStdDev);
    result += ('\t' + resData);
    console.log(result);
}

showResult('[' + configId + '.create]', times.setup);
showResult('[' + configId + '.consume]', times.consume);

console.log(results[0].length);

// ---------------------------------------------------------------------------
//
// Results:
//   const ENTRY_COUNT = 10000;
//   const BUILD_COUNT = 200;
//   const TEST_RUNS = 10;
//   const CONSUME_RUNS = 10;
//
//    TEST                CREATE            CONSUME
//                      mean   stddev         mean   stddev
//    nullFuncs         73.6     0.20         508.8    0.79
//
//    fullObject       503.7     1.65         559.6    2.22
//    nestObject       732.3    28.76         610.0    2.45
//    newArray         787.1     4.56         560.9    2.51
//    nestArray        969.4    67.73         657.9    2.51
//    expandArray    1,557.4    49.34       1,228.3    3.97
//
