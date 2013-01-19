// Minecraft Tags IO Implementation in JS
// Daniel Stephens (iriel@iriel.org), Jan 2013

// Start with an IOTags style reader backed by a buffer and stream?

var util = require('util');
var Stream = require('stream').Stream;
// var memoize = require('memoizee');

// TODO add a value compatibility check function
var TagType = function(id, label) {
    Object.defineProperty(this, 'id', { enumerable : true, value: id,  writable: false });
    Object.defineProperty(this, 'label', { enumerable: true, value: label,  writable: false });
    Object.defineProperty(this, "_listType", { value: null, writable: true });
}

TagType.prototype.getListType = function() {
    var listType = this._listType;
    if (!listType) { 
	listType = new TagType(9, "List of " + this.label);
	this._listType = listType;
    }
    return listType;
}

var TAG_TYPE_END = new TagType(0, 'End');
var TAG_TYPE_BYTE = new TagType(1, 'Byte');
var TAG_TYPE_SHORT = new TagType(2, 'Short');
var TAG_TYPE_INT = new TagType(3, 'Int');
var TAG_TYPE_LONG = new TagType(4, 'Long');
var TAG_TYPE_FLOAT = new TagType(5, 'Float');
var TAG_TYPE_DOUBLE = new TagType(6, 'Double');
var TAG_TYPE_BYTE_ARRAY = new TagType(7, 'Byte Array');
var TAG_TYPE_STRING = new TagType(8, 'String');
var TAG_TYPE_LIST = new TagType(9, 'List');
var TAG_TYPE_OBJECT = new TagType(10, 'Object');
var TAG_TYPE_INT_ARRAY = new TagType(11, 'Int Array');

exports.TAG_TYPE_END = TAG_TYPE_END;
exports.TAG_TYPE_BYTE = TAG_TYPE_BYTE;
exports.TAG_TYPE_SHORT = TAG_TYPE_SHORT;
exports.TAG_TYPE_INT = TAG_TYPE_INT;
exports.TAG_TYPE_LONG = TAG_TYPE_LONG;
exports.TAG_TYPE_FLOAT = TAG_TYPE_FLOAT;
exports.TAG_TYPE_DOUBLE = TAG_TYPE_DOUBLE;
exports.TAG_TYPE_BYTE_ARRAY = TAG_TYPE_BYTE_ARRAY;
exports.TAG_TYPE_STRING = TAG_TYPE_STRING;
exports.TAG_TYPE_LIST = TAG_TYPE_LIST;
exports.TAG_TYPE_OBJECT = TAG_TYPE_OBJECT;
exports.TAG_TYPE_INT_ARRAY = TAG_TYPE_INT_ARRAY;

var TAG_TYPES = [
    TAG_TYPE_END, TAG_TYPE_BYTE, TAG_TYPE_SHORT, TAG_TYPE_INT, TAG_TYPE_LONG,
    TAG_TYPE_FLOAT, TAG_TYPE_DOUBLE, TAG_TYPE_BYTE_ARRAY, TAG_TYPE_STRING,
    TAG_TYPE_LIST, TAG_TYPE_OBJECT, TAG_TYPE_INT_ARRAY ];

var TAG_TYPES_BY_ID = {};
for (var i = 0; i < TAG_TYPES.length; ++i) {
    var tagType = TAG_TYPES[i];
    TAG_TYPES_BY_ID[tagType.id] = tagType;
}

var tagTypeForId = function(id) {
    return TAG_TYPES_BY_ID[id];
}

exports.tagTypeForId = tagTypeForId;

// ---------------------------------------------------------------------------

var TagTypedEnumeration = function(type, id, label, enumerableId) {
    if (enumerableId == null) { enumerableId = true; }
    Object.defineProperty(this, '_tagType', { enumerable : false, value: type,  writable: false });
    Object.defineProperty(this, 'id', { enumerable: enumerableId, value: id,  writable: false });
    Object.defineProperty(this, 'label', { enumerable: true, value : label, writable: false });
}

exports.TagTypedEnumeration = TagTypedEnumeration;


// ---------------------------------------------------------------------------
// Possibly overengineered abstraction!

// TODO use some kind of weak memoization on this
var createPropertyMap =function(id) {
    return { get : function() { return this.getValue(id); },
	     set : function(nv) { this.setValue(id, nv); },
	     enumerable: true };
};

var TaggedMap = function(entries) {
    var entryMap = {};
    Object.defineProperty(this, '__entryMap', { value: entryMap, writable: false }); 
    Object.defineProperty(this, '__entries', { value: entries, writable: false }); 
    for (var i = 0; i < entries.length; ++i) {
	var ent = entries[i];
	var id = ent[0];
	Object.defineProperty(this, id, createPropertyMap(id));
	entryMap[ent[0]] = ent;
    }
}

TaggedMap.prototype.getValue = function(id) {
    var ent = this.__entryMap[id];
    var conv = ent[2];
    if (conv) {
	return conv.onGet(ent[1][1], ent[1][0]);
    } else {
	return ent[1][1];
    }
}

TaggedMap.prototype.setValue = function(id, val) {
    var ent = this.__entryMap[id];
    // TODO check type!!!!
    ent[1][1] = val;
}

TaggedMap.prototype.getType = function(id) {
    var ent = this.__entryMap[id];
    return (ent == null) ? null : ent[1][0];
}

TaggedMap.prototype.getEntry = function(id) {
    return this.__entryMap[id];
}
TaggedMap.prototype.getEntries = function() {
    return this.__entries;
}

exports.TaggedMap = TaggedMap;

// ---------------------------------------------------------------------------
//
// TagReader - Provides methods to read tags from a stream, itself implements
//             a Writable Stream so it can have data piped into it.
//

var TagReader = function() {
    this.writable = true;
    this._limit = 0;
    this._pos = 0;
    this._helpers = [];
    this._states = [];
    this._pending = [];
}

util.inherits(TagReader, Stream);

TagReader.prototype.write = function(buffer) {
    if (this._ended) { throw new Error("TagReader: write after end"); }
    if (!Buffer.isBuffer(buffer)) {
	throw new Error("TagREader: Only buffers are supported");
    }

    if (this._limit > this._pos) {
	// Must join remaining buffer with new one
	var remaining = this._limit - this._pos;
	var newBuffer = new Buffer(buffer.length + remaining);
	// Must specify end point since we might have been constrained
	this._buffer.copy(newBuffer, 0, this._pos, this._pos + remaining);
	buffer.copy(newBuffer, remaining, 0);
	buffer = newBuffer;
    }
    this._buffer = buffer;
    this._limit = buffer.length;
    this._pos = 0;

    // Will return false if there's nothing to do
    return this._consume();
}

TagReader.prototype.end = function(buffer) {
    if (buffer) { this.write(buffer); }
    this._ended = true;
    this.writable = false;
    this._consume();
}

TagReader.prototype._readString = function() {
    var buffer = this._buffer;
    var pos = this._pos;
    var limit = this._limit;
    // Insufficient data for the length
    if (pos > (limit - 2)) { return; }
    var strBytes = buffer.readInt16BE(pos);
    // Insufficient data for the length + string
    if (pos > (limit - (2 + strBytes))) { return; }
    var str = (strBytes == 0) ? "" : buffer.toString('utf8', pos + 2, pos + 2 + strBytes);
    this._pos += (strBytes + 2);
    return str;
}

// Each tag helper returns the helper that follows it, or
// STALLED if it has stalled (in which case it'll be re-invoked
// later, and must pick up where it left off).
//
// Returning COMPLETE means this handler did its work.
//
// Can also return an array, in which case the first element of the array
// is the new handler, and the second is the 'value' to either return to the
// caller, or to pass back in on resumption.
//
// Returning [ DELEGATE, helper ] passes control to the new helper
// without retaining state
var STALLED = function() { throw "Stalled!" };
var COMPLETE = function() { throw "Complete!" };
var DELEGATE = function() { throw "Delegated!" };

var MODE_START = 0; // Handler has just started
var MODE_RESUMED = 1; // Handler is resumed after stall
var MODE_RETURNED = 2; // Handler has returned from child
var MODE_ERROR = -1; // Root handler informed of failure

var TAG_TYPE_HELPERS = {};
var AddTypeHelper = function(type, helper) {
//    util.log("Registering type helper for " + JSON.stringify(type));
    TAG_TYPE_HELPERS[type.id] = helper;
}

var selectTagTypeHelper = function(tagType) {
    var helper = TAG_TYPE_HELPERS[tagType];
    if (helper == null) {
	var tagType = tagTypeForId(tagType);
	if (tagType) {
	    throw new Error("No helper defined for "
			    + JSON.stringify(tagType));
	}
	throw new Error("Unknown tag type " + tagType);
    }
    return helper;
}

var readNamedTagHelper = function(reader, buffer, mode, state, value) {
    if (mode == MODE_RETURNED) {
	return [ COMPLETE, [ state, value ] ];
    }
    if (reader._pos >= reader._limit) { return STALLED; }
    var tagType = buffer.readInt8(reader._pos++);
    // util.log("Tag type " + tagType);
    if (tagType == 0) {
	// END TAG - terminates map.
	return COMPLETE;
    }
    var id = reader._readString();
    if (id == null) {
	// Unable to consume string, must put back the tag type
	--reader._pos;
	return STALLED;
    }
    return [ selectTagTypeHelper(tagType), id ]
}

AddTypeHelper(TAG_TYPE_OBJECT,
	      function(reader, buffer, mode, state, value) {
		  if (mode == MODE_START) {
		      state = [];
		  }
		  if (mode == MODE_RETURNED) {
		      if (value == null) {
			  return [ COMPLETE, [ TAG_TYPE_OBJECT, new TaggedMap(state) ] ];
		      } 
		      state.push(value);
		  }
		  return [ readNamedTagHelper, state ];
	      });

AddTypeHelper(TAG_TYPE_LIST,
	      function(reader, buffer, mode, state, value) {
		  if (mode == MODE_START) {
		      state = {
			  values : []
		      };
		  }
		  if (!state.tagType) {
		      if (reader._pos >= reader._limit) { return [STALLED, state]; }
		      state.tagType = buffer.readInt8(reader._pos++);
		  }
		  if (!state.length) {
		      if ((reader._pos + 4) > reader._limit) { return [STALLED, state]; }
		      state.length = buffer.readInt32BE(reader._pos);
		      reader._pos += 4;
		  }
		  if (mode == MODE_RETURNED || state.length == 0) {
		      if (mode == MODE_RETURNED) {
			  state.values.push(value[1]);
		      }
		      if (state.values.length == state.length) {
			  return [ COMPLETE, [ tagTypeForId(state.tagType).getListType(),
					       state.values ] ];
		      }
		  }
		  return [ selectTagTypeHelper(state.tagType), state ];
	      });

AddTypeHelper(TAG_TYPE_BYTE_ARRAY,
	      function(reader, buffer, mode, state, value) {
    if (mode == MODE_START) {
	state = {
	}
    }
    if (!state.buffer) {
	if ((reader._pos + 4) > reader._limit) { return [STALLED, state]; }
	var length = buffer.readInt32BE(reader._pos);
	state.buffer = new Buffer(length);
	state.pos = 0;
	reader._pos += 4;
    }
    while (state.pos < state.buffer.length) {
	if (reader._pos >= reader._limit) { return [ STALLED, state ]; }
	var needed = state.buffer.length - state.pos;
	var avail = reader._limit - reader._pos;
	var toCopy = (needed < avail) ? needed : avail;
	/* util.log('Needed: ' + needed + "; Avail: " + avail
		 + "; ToCopy: " + toCopy + "; StatePos: " + state.pos); */
	buffer.copy(state.buffer, state.pos, reader._pos, reader._pos + toCopy);
	state.pos += toCopy;
	reader._pos += toCopy;
    }
    return [ COMPLETE, [ TAG_TYPE_BYTE_ARRAY, state.buffer ] ];
	      });

AddTypeHelper(TAG_TYPE_INT_ARRAY,
	      function(reader, buffer, mode, state, value) {
    if (mode == MODE_START) {
	state = {
	}
    }
    if (!state.buffer) {
	if ((reader._pos + 4) > reader._limit) { return [STALLED, state]; }
	var length = buffer.readInt32BE(reader._pos);
	state.buffer = new Buffer(length * 4);
	state.pos = 0;
	reader._pos += 4;
    }
    while (state.pos < state.buffer.length) {
	if (reader._pos >= reader._limit) { return [ STALLED, state ]; }
	var needed = state.buffer.length - state.pos;
	var avail = reader._limit - reader._pos;
	var toCopy = (needed < avail) ? needed : avail;
	/* util.log('Needed: ' + needed + "; Avail: " + avail
		 + "; ToCopy: " + toCopy + "; StatePos: " + state.pos); */
	buffer.copy(state.buffer, state.pos, reader._pos, reader._pos + toCopy);
	state.pos += toCopy;
	reader._pos += toCopy;
    }
    return [ COMPLETE, [ TAG_TYPE_INT_ARRAY, state.buffer ] ];
	      });

AddTypeHelper(TAG_TYPE_INT,
	      function(reader, buffer, mode, state, value) {
		  var pos = reader._pos;
		  if (pos + 4 > reader._limit) { return STALLED; }
		  var val = buffer.readInt32BE(pos);
		  reader._pos += 4;
		  return [ COMPLETE, [ TAG_TYPE_INT, val ] ];
	      });

AddTypeHelper(TAG_TYPE_BYTE,
	      function(reader, buffer, mode, state, value) {
		  var pos = reader._pos;
		  if (pos + 1 > reader._limit) { return STALLED; }
		  var val = buffer.readInt8(pos);
		  reader._pos += 1;
		  return [ COMPLETE, [ TAG_TYPE_BYTE, val ] ];
	      });

AddTypeHelper(TAG_TYPE_SHORT,
	      function(reader, buffer, mode, state, value) {
		  var pos = reader._pos;
		  if (pos + 2 > reader._limit) { return STALLED; }
		  var val = buffer.readInt16BE(pos);
		  reader._pos += 2;
		  return [ COMPLETE, [ TAG_TYPE_SHORT, val ] ];
	      });

AddTypeHelper(TAG_TYPE_LONG,
	      function(reader, buffer, mode, state, value) {
		  var pos = reader._pos;
		  if (pos + 8 > reader._limit) { return STALLED; }
		  var hiVal = buffer.readInt32BE(pos);
		  var loVal = buffer.readInt32BE(pos + 4);
		  var result = hiVal << 32 + loVal;
		  reader._pos += 8;
		  return [ COMPLETE, [ TAG_TYPE_LONG, result ] ];
	      });

AddTypeHelper(TAG_TYPE_FLOAT,
	      function(reader, buffer, mode, state, value) {
		  var pos = reader._pos;
		  if (pos + 4 > reader._limit) { return STALLED; }
		  var val = buffer.readFloatBE(pos);
		  reader._pos += 4;
		  return [ COMPLETE, [ TAG_TYPE_FLOAT, val ] ];
	      });

AddTypeHelper(TAG_TYPE_DOUBLE,
	      function(reader, buffer, mode, state, value) {
		  var pos = reader._pos;
		  if (pos + 8 > reader._limit) { return STALLED; }
		  var val = buffer.readDoubleBE(pos);
		  reader._pos += 8;
		  return [ COMPLETE, [ TAG_TYPE_DOUBLE, val ] ];
	      });

AddTypeHelper(TAG_TYPE_STRING,
	      function(reader, buffer, mode, state, value) {
		  var str = reader._readString();
		  if (str == null) { return STALLED; }
		  return [ COMPLETE, [ TAG_TYPE_STRING, str ] ];
	      });

TagReader.prototype._consume = function() {
    // util.log("Consuming data...");
    var buffer = this._buffer;
    var limit = this._limit;
    var helpers = this._helpers;
    var states = this._states;
    var mode = MODE_RESUMED;
    var value = null;

    while (true) {
	var helper;
	var state;
	if (helpers.length == 0) {
	    this._curtask = null;
	    var pending = this._pending;
	    if (pending.length == 0) {
		return this._pos >= this._limit;
	    }
	    helper = pending.shift();
	    this._curtask = helper;
	    mode = MODE_START;
	    state = null;
	    value = null;
	} else {
	    helper = helpers.pop();
	    state = states.pop();
	}
	while (helper != null) {
	    /* util.log("Invoking helper; mode: " + mode 
		     + "; state: " + JSON.stringify(state) 
		     + "; value: " + JSON.stringify(value)
		     + "; pos: " + this._pos); */
	    var nextHelper = helper(this, buffer, mode, state, value);
	    if (util.isArray(nextHelper)) {
		value = nextHelper[1];
		nextHelper = nextHelper[0];
	    } else {
		value = null;
	    }

	    if (nextHelper == COMPLETE) {
		mode = MODE_RETURNED;
		//util.log("Helper returned; value: " + JSON.stringify(value));
		helper = null;
		state = null;
		// Completed one iteration!
		break;
	    }
	    if (nextHelper == STALLED) {
		// util.log("Consumption stalled.");
		helpers.push(helper);
		/*if (value) {
		    util.log('Pushing state: ' + JSON.stringify(value));
		} */
		states.push(value);
		if (this._ended) {
		    this._fail('EOF during parse');
		    return false;
		}
		this.emit('drain');
		// WE WANT MORE!
		return true;
	    }
	    if (nextHelper == DELEGATE) {
		// util.log("Helper delegated...");
		helper = value;
		value = null;
		state = null;
		continue;
	    }
	    if (nextHelper == null) {
		this._fail('No helper returned to continue processing');
		return false;
	    }

	    helpers.push(helper);
	    states.push(value);

	    helper = nextHelper;
	    mode = MODE_START;
	    value = null;
	    state = null;
	}
    }
}

TagReader.prototype._fail = function(error) {
    if (this._failed) { return; }
    util.log("Signaling failure: " + error);
    if (!error) { error = "TagReader: Failed"; }
    this._failed = error;
    this.writable = false;
    if (this._curtask) {
	this._curtask(this, null, MODE_ERROR, null, error);
    }
    while (this._pending.length > 1) {
	var handler = this._pending.unshift();
	handler(this, null, MODE_ERROR, null, error);
    }
    this.emit('error', 'Failed');
}

TagReader.prototype.readValue = function(callback) {
    if (this._failed) {
	callback(this._failed);
	return;
    }
    if (this._ended && this._pos >= this._limit) {
	callback(null, null);
	return;
    }
    var helper = function(reader, buffer, mode, state, value) {
	if (mode == MODE_ERROR) {
	    callback(value);
	    return;
	}
	if (mode == MODE_RETURNED) {
	    callback(null, value);
	    return COMPLETE;
	}
	if (reader._pos >= reader._limit) {
	    if (reader._ended) {
		callback(null, null);
		return COMPLETE;
	    }
	    return STALLED;
	}

	return readNamedTagHelper
    }
    this._pending.push(helper);
    if (this._pending.length == 1) {
	this._consume();
    }
}

TagReader.prototype.readObject = function(callback) {
    if (this._failed) {
	util.log("CALLBACK: Immediate Failed");
	callback(this._failed);
	return;
    }
    if (this._ended && this._pos >= this._limit) {
	callback(null);
	return;
    }
    var helper = function(reader, buffer, mode, state, value) {
	if (mode == MODE_ERROR) {
	    util.log("CALLBACK: MODE_ERROR " + value);
	    callback(value);
	    return;
	}
	if (mode == MODE_RETURNED) {
	    if (value == null) {
		callback(null);
	    } else {
		callback(null, value[1][1], value[0]);
	    }
	    return COMPLETE;
	}
	if (reader._pos >= reader._limit) {
	    if (reader._ended) {
		callback(null);
		return COMPLETE;
	    }
	    return STALLED;
	}
	var nextTagType = buffer.readInt8(reader._pos);
	if (nextTagType != 10) {
	    reader._fail("Expected object, got tag type " + nextTagType);
	    return;
	}

	return readNamedTagHelper;
    }
    this._pending.push(helper);
    if (this._pending.length == 1) {
	this._consume();
    }
}

exports.TagReader = TagReader;
