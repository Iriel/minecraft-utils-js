// Minecraft Tags IO Implementation in JS
// Daniel Stephens (iriel@iriel.org), Jan 2013

// Start with an IOTags style reader backed by a buffer and stream?

var util = require('util');
var Stream = require('stream').Stream;

// TODO add a value compatibility check function??
var TagType = function(id, label) {
    Object.defineProperty(this, 'id', { enumerable : true, value: id,  writable: false });
    Object.defineProperty(this, 'label', { enumerable: true, value: label,  writable: false });
    Object.defineProperty(this, "_listType", { enumerable: false, value: null, writable: true });
}

TagType.prototype.getListType = function() {
    var listType = this._listType;
    if (!listType) { 
	listType = new TagType(9, "List of " + this.label);
	this._listType = listType;
    }
    return listType;
}

TagType.prototype.toString = function() {
    return this.label;
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

var getTagTypes = function() {
    return TAG_TYPES.slice();
}

exports.getTagTypes = getTagTypes;

// ---------------------------------------------------------------------------
// Fairly basic representation of a minecraft "Object", largely optimized for
// JS reading. Since attempting to write to the object is going to break some
// expectations later, the object is frozen.
var SimpleTaggedObject = function(entries) {
    Object.defineProperty(this, '__entries', { value: entries });
    var entryMap = null;
    var getEntryMap = function() {
	if (entryMap == null) {
	    var map = {};
	    for (var i = 0; i < entries.length; ++i) {
		var ent = entries[i];
		map[ent.id] = ent;
	    }
	    entryMap = map;
	}
	return entryMap;
    }
    Object.defineProperty(this, '__entryMap', { get : getEntryMap });
    for (var i = 0; i < entries.length; ++i) {
	var ent = entries[i];
	this[ent.id] = ent.value;
    }
    Object.freeze(this);
}


SimpleTaggedObject.prototype.getEntries = function() { return this.__entries; }

SimpleTaggedObject.prototype.getEntry = function(id) {
    return this.__entryMap[id];
}

SimpleTaggedObject.prototype.getType = function(id) {
    var ent = this.__entryMap[id];
    return (ent == null) ? null : ent.type;
}

SimpleTaggedObject.prototype.getValue = function(id) {
    var ent = this.__entryMap[id];
    return (ent == null) ? null : ent.value;
}

exports.SimpleTaggedObject = SimpleTaggedObject;

// ---------------------------------------------------------------------------
//
// TagReader - Provides methods to read tags from a stream, itself implements
//             a Writable Stream so it can have data piped into it.
//

const defaultObjectFactory = function(entries) {
    return { type : TAG_TYPE_OBJECT, value : new SimpleTaggedObject(entries) }
}

const defaultListFactory = function(entryType, entries) {
    return { type : entryType.getListType(), value : entries }
}

const defaultByteArrayFactory = function(data) {
    return { type : TAG_TYPE_BYTE_ARRAY, value : data }
}

const defaultIntArrayFactory = function(data) {
    return { type : TAG_TYPE_INT_ARRAY, value : data }
}

var TagReader = function(opts) {
    if (opts == null) {
	opts = {};
    }
    this.writable = true;
    this._limit = 0;
    this._pos = 0;
    this._helpers = [];
    this._states = [];
    this._pending = [];
    this.createObjectValue = opts.objectFactory || defaultObjectFactory;
    this.createListValue = opts.listFactory || defaultListFactory;
    this.createByteArrayValue = opts.byteArrayFactory || defaultByteArrayFactory;
    this.createIntArrayValue = opts.intArrayFactory || defaultIntArrayFactory;
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

// Each tag helper returns an object with the following characteristics.
//
// If the key 'next' is present (and true) it's the next helper in the chain
// the key 'state' can hold persistent state for the helper that returned, and
// the key 'initValue' can provide an initial value for the new helper.
//
// If the key 'stalled' is present (and true) then consumption has stalled due to
// insufficient input, it will be resumed later once there's more data available.
// the key 'state' can hold persistent state for the helper when it comes back.
//
// Otherwise the result indicates completion of a step, the key 'result' contains
// the value to pass to the caller.
//
// The constants STALLED and COMPLETE are provided for no-state-no-value responses.
const STALLED = { stalled : true }
const COMPLETE = { result: null };

var MODE_START = 0; // Handler has just started
var MODE_RESUMED = 1; // Handler is resumed after stall
var MODE_RETURNED = 2; // Handler has returned from child
var MODE_ERROR = -1; // Root handler informed of failure

var TAG_TYPE_HELPERS = {};
var AddTypeHelper = function(type, helper) {
    TAG_TYPE_HELPERS[type.id] = helper;
    helper.id = "tagTypeHelper:" + type.label;
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
	return { result : { id : state, type : value.type, value : value.value } } 
    }
    if (reader._pos >= reader._limit) { return STALLED; }
    var tagType = buffer[reader._pos++];
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
    return { next : selectTagTypeHelper(tagType), state : id }
}
readNamedTagHelper.id = 'readNamedTagHelper';

AddTypeHelper(TAG_TYPE_OBJECT,
	      function(reader, buffer, mode, state, value) {
		  if (mode == MODE_START) {
		      state = [];
		  }
		  if (mode == MODE_RETURNED) {
		      if (value == null) {
			  return { result : reader.createObjectValue(state) };
		      } 
		      state.push(value);
		  }
		  return { next : readNamedTagHelper, state : state };
	      });

AddTypeHelper(TAG_TYPE_LIST,
	      function(reader, buffer, mode, state, value) {
		  if (mode == MODE_START) {
		      // Use state object as its own stall indicator
		      state = {
			  stalled : true,
			  tagType : null,
			  length : null,
			  index : null,
			  values : null,
			  state : null
		      };
		      state.state = state;
		  }
		  if (!state.tagType) {
		      if (reader._pos >= reader._limit) { return state; }
		      state.tagType = buffer[reader._pos++];
		  }
		  if (state.length == null) {
		      if ((reader._pos + 4) > reader._limit) { return state; }
		      var length = buffer.readInt32BE(reader._pos);
		      state.length = length;
		      state.values = new Array(length);
		      state.index = 0;
		      reader._pos += 4;
		  }
		  if (mode == MODE_RETURNED || state.length == 0) {
		      if (mode == MODE_RETURNED) {
			  /* Can trust the result type since we dispatched a
			   * type-specific helper. */
			  state.values[state.index++] = value.value;
		      }
		      if (state.index == state.length) {
			  var type = tagTypeForId(state.tagType);
			  return { result : reader.createListValue(type, state.values) };
		      }
		  }
		  return { next : selectTagTypeHelper(state.tagType), state : state };
	      });

AddTypeHelper(TAG_TYPE_BYTE_ARRAY, function(reader, buffer, mode, state, value) {
    if (mode == MODE_START) {
	state = {
	    buffer : null,
	    pos : null,
	    stalled : true, // Own stall indicator
	    state : null,
	};
	state.state = state;
    }
    if (!state.buffer) {
	if ((reader._pos + 4) > reader._limit) { return state; }
	var length = buffer.readInt32BE(reader._pos);
	state.buffer = new Buffer(length);
	state.pos = 0;
	reader._pos += 4;
    }
    while (state.pos < state.buffer.length) {
	if (reader._pos >= reader._limit) { return state; }
	var needed = state.buffer.length - state.pos;
	var avail = reader._limit - reader._pos;
	var toCopy = (needed < avail) ? needed : avail;
	buffer.copy(state.buffer, state.pos, reader._pos, reader._pos + toCopy);
	state.pos += toCopy;
	reader._pos += toCopy;
    }
    return { result : reader.createByteArrayValue(state.buffer) };
});

AddTypeHelper(TAG_TYPE_INT_ARRAY, function(reader, buffer, mode, state, value) {
    if (mode == MODE_START) {
	state = {
	    buffer : null,
	    pos : null,
	    stalled : true, // Own stall indicator
	    state : null,
	};
	state.state = state;
    }
    if (!state.buffer) {
	if ((reader._pos + 4) > reader._limit) { return state; }
	var length = buffer.readInt32BE(reader._pos);
	state.buffer = new Buffer(length * 4);
	state.pos = 0;
	reader._pos += 4;
    }
    while (state.pos < state.buffer.length) {
	if (reader._pos >= reader._limit) { return state; }
	var needed = state.buffer.length - state.pos;
	var avail = reader._limit - reader._pos;
	var toCopy = (needed < avail) ? needed : avail;
	buffer.copy(state.buffer, state.pos, reader._pos, reader._pos + toCopy);
	state.pos += toCopy;
	reader._pos += toCopy;
    }
    return { result : reader.createIntArrayValue(state.buffer) };
});

AddTypeHelper(TAG_TYPE_INT, function(reader, buffer, mode, state, value) {
    var pos = reader._pos;
    if (pos + 4 > reader._limit) { return STALLED; }
    var val = buffer.readInt32BE(pos);
    reader._pos += 4;
    return { result : { type : TAG_TYPE_INT, value : val } };
});

AddTypeHelper(TAG_TYPE_BYTE, function(reader, buffer, mode, state, value) {
    var pos = reader._pos;
    if (pos + 1 > reader._limit) { return STALLED; }
    var val = buffer[pos];
    reader._pos += 1;
    return { result : { type : TAG_TYPE_BYTE, value : val } };
});

AddTypeHelper(TAG_TYPE_SHORT, function(reader, buffer, mode, state, value) {
    var pos = reader._pos;
    if (pos + 2 > reader._limit) { return STALLED; }
    var val = buffer.readInt16BE(pos);
    reader._pos += 2;
    return { result : { type : TAG_TYPE_SHORT, value : val } };
});

AddTypeHelper(TAG_TYPE_LONG, function(reader, buffer, mode, state, value) {
    var pos = reader._pos;
    if (pos + 8 > reader._limit) { return STALLED; }
    var hiVal = buffer.readInt32BE(pos);
    var loVal = buffer.readInt32BE(pos + 4);
    // TODO worry about overflow??
    var result = hiVal << 32 + loVal;
    reader._pos += 8;
    return { result : { type : TAG_TYPE_LONG, value : result } };
});

AddTypeHelper(TAG_TYPE_FLOAT, function(reader, buffer, mode, state, value) {
    var pos = reader._pos;
    if (pos + 4 > reader._limit) { return STALLED; }
    var val = buffer.readFloatBE(pos);
    reader._pos += 4;
    return { result : { type : TAG_TYPE_FLOAT, value : val } };
});

AddTypeHelper(TAG_TYPE_DOUBLE, function(reader, buffer, mode, state, value) {
    var pos = reader._pos;
    if (pos + 8 > reader._limit) { return STALLED; }
    var val = buffer.readDoubleBE(pos);
    reader._pos += 8;
    return { result : { type : TAG_TYPE_DOUBLE, value : val } };
});

AddTypeHelper(TAG_TYPE_STRING, function(reader, buffer, mode, state, value) {
    var str = reader._readString();
    if (str == null) { return STALLED; }
    return { result : { type : TAG_TYPE_STRING, value : str } };
});

TagReader.prototype._consume = function() {
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
/*	    util.log("Invoking helper: " + helper.id 
		     + "; mode: " + mode
		     + "; state: " + ((state && state.state) ? "(recursive)" : JSON.stringify(state))
		     + "; value: " + JSON.stringify(value)
		     + "; pos: " + this._pos); */
	    var response = helper(this, buffer, mode, state, value);
	    if (response.next) {
		helpers.push(helper);
		states.push(response.state);
		helper = response.next;
		mode = MODE_START;
		value = response.initValue;
		state = null;
	    } else if (response.stalled) {
		helpers.push(helper);
		states.push(response.state);
		if (this._ended) {
		    this._fail('EOF during parse');
		    return false;
		}
		this.emit('drain');
		// WE WANT MORE!
		return true;
	    } else {
		mode = MODE_RETURNED;
		value = response.result;
		/* util.log("Helper returned; value: " + JSON.stringify(value)); */
		helper = null;
		state = null;
		// Completed one iteration!
		break;
	    }
	}
    }
}

TagReader.prototype._fail = function(error) {
    if (this._failed) { return; }
    //util.log("Signaling failure: " + error);
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

const READ_NAMED_TAG_NEXT = { next : readNamedTagHelper }

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

	return READ_NAMED_TAG_NEXT;
    }
    helper.id = "readValue";
    this._pending.push(helper);
    if (this._pending.length == 1) {
	this._consume();
    }
}

TagReader.prototype.readObject = function(callback) {
    if (this._failed) {
	callback(this._failed);
	return;
    }
    if (this._ended && this._pos >= this._limit) {
	callback(null);
	return;
    }
    var helper = function(reader, buffer, mode, state, value) {
	if (mode == MODE_ERROR) {
	    callback(value);
	    return;
	}
	if (mode == MODE_RETURNED) {
	    if (value == null) {
		callback(null);
	    } else {
		callback(null, value.value, value.id);
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
	var nextTagType = buffer[reader._pos];
	if (nextTagType != 10) {
	    reader._fail("Expected object, got tag type " + nextTagType);
	    return;
	}

	return READ_NAMED_TAG_NEXT;
    }
    helper.id = "readObject";
    this._pending.push(helper);
    if (this._pending.length == 1) {
	this._consume();
    }
}

exports.TagReader = TagReader;
