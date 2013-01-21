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

const defaultObjectFactory = function(id, entries) {
    return { id : id, type : TAG_TYPE_OBJECT, value : new SimpleTaggedObject(entries) }
}

const defaultListFactory = function(id, entryType, entries) {
    return { id : id, type : entryType.getListType(), value : entries }
}

const defaultByteArrayFactory = function(id, data) {
    return { id : id, type : TAG_TYPE_BYTE_ARRAY, value : data }
}

const defaultIntArrayFactory = function(id, data) {
    return { id : id, type : TAG_TYPE_INT_ARRAY, value : data }
}

var TagReader = function(opts) {
    if (opts == null) {
	opts = {};
    }
    this.writable = true;
    this._limit = 0;
    this._pos = 0;
    this._helpers = [];
    this._pending = [];
    this.createObjectValue = opts.objectFactory || defaultObjectFactory;
    this.createListValue = opts.listFactory || defaultListFactory;
    this.createByteArrayValue = opts.byteArrayFactory || defaultByteArrayFactory;
    this.createIntArrayValue = opts.intArrayFactory || defaultIntArrayFactory;
    var that = this;
    this.on('error', function(err) {
	that._fail(err);
    });
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
    var strBytes = buffer.readUInt16BE(pos);
    // Insufficient data for the length + string
    if (pos > (limit - (2 + strBytes))) { return; }
    var str = (strBytes == 0) ? "" : buffer.toString('utf8', pos + 2, pos + 2 + strBytes);
    this._pos += (strBytes + 2);
    return str;
}

// TODO re-document helper protocol
var TAG_TYPE_HELPERS = {};
var AddTypeHelper = function(type, helperFactory) {
    var helper = helperFactory();
    TAG_TYPE_HELPERS[type.id] = helper;
    helper.prototype.toString = function() { 
	return type.label + " TagTypeHelper";
    }
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
    return new helper();
}

var ReadNamedTagHelper = function() { }
ReadNamedTagHelper.prototype.consume = function(reader, buffer, limit, child) {
    if (child) {
	this.value = child.createEntry(reader, this.id);
	return;
    }
    if (reader._pos >= limit) { return false; }
    var tagType = buffer[reader._pos++];
    if (tagType == 0) {
	// END TAG - terminates map.
	return;
    }
    var id = reader._readString();
    if (id == null) {
	// Unable to consume string, must put back the tag type
	--reader._pos;
	return false;
    }
    this.id = id;
    return selectTagTypeHelper(tagType);
}
ReadNamedTagHelper.prototype.toString = function() { return 'ReadNamedTagHelper'; }

AddTypeHelper(TAG_TYPE_OBJECT, function() {
    var ObjectHelper = function() {
	this.entries = [];
	this.entryId = null;
    }
    ObjectHelper.prototype.createEntry = function(reader, id) {
	return reader.createObjectValue(id, this.entries);
    }
    ObjectHelper.prototype.consume = function(reader, buffer, limit, child) {
	if (child) {
	    var value = child.createEntry(reader, this.entryId);
	    this.entryId = null;
	    this.entries.push(value);
	}
	if (reader._pos >= limit) { return false; }
	var tagType = buffer[reader._pos++];
	if (tagType == 0) {
	    return;
	}
	var id = reader._readString();
	if (id == null) {
	    // Unable to consume string, must put back the tag type
	    --reader._pos;
	    return false;
	}
	this.entryId = id;
	return selectTagTypeHelper(tagType);
    }

    return ObjectHelper;
});

AddTypeHelper(TAG_TYPE_LIST, function() {
    var ListHelper = function() { }

    ListHelper.prototype.createEntry = function(reader, id) {
	var type = tagTypeForId(this.tagType);
	return reader.createListValue(id, type, this.values);
    }

    ListHelper.prototype.consume = function(reader, buffer, limit, child) {
	if (child) {
	    var value = child.value;
	    if (!value) {
		value = child.createEntry(reader, "").value;
	    }
	    this.values[this.index++] = value;
	}
	if (!this.tagType) {
	    if (reader._pos >= limit) { return false; }
	    this.tagType = buffer[reader._pos++];
	}
	if (this.length == null) {
	    if ((reader._pos + 4) > limit) { return false; }
	    var length = buffer.readInt32BE(reader._pos);
	    this.length = length;
	    this.values = new Array(length);
	    this.index = 0;
	    reader._pos += 4;
	}
	if (this.values && this.index == this.length) {
	    return;
	}
	return selectTagTypeHelper(this.tagType);
    }

    return ListHelper;
});

AddTypeHelper(TAG_TYPE_BYTE_ARRAY, function() {
    var ByteArrayHelper = function() { };

    ByteArrayHelper.prototype.createEntry = function(reader, id) {
	return reader.createByteArrayValue(id, this.buffer);
    }
    ByteArrayHelper.prototype.consume = function(reader, buffer, limit, child) {
	if (!this.buffer) {
	    if ((reader._pos + 4) > limit) { return false; }
	    var length = buffer.readInt32BE(reader._pos);
	    this.buffer = new Buffer(length);
	    this.pos = 0;
	    reader._pos += 4;
	}

	var len = this.buffer.length;

	while (this.pos < len) {
	    if (reader._pos >= limit) { return false; }
	    var needed = this.buffer.length - this.pos;
	    var avail = limit - reader._pos;
	    var toCopy = (needed < avail) ? needed : avail;
	    buffer.copy(this.buffer, this.pos, reader._pos, reader._pos + toCopy);
	    this.pos += toCopy;
	    reader._pos += toCopy;
	}
    }

    return ByteArrayHelper;
});

AddTypeHelper(TAG_TYPE_INT_ARRAY, function() {
    var IntArrayHelper = function() { };

    IntArrayHelper.prototype.createEntry = function(reader, id) {
	return reader.createIntArrayValue(id, this.buffer);
    }
    IntArrayHelper.prototype.consume = function(reader, buffer, limit, child) {
	if (!this.buffer) {
	    if ((reader._pos + 4) > limit) { return false; }
	    var length = buffer.readInt32BE(reader._pos);
	    this.buffer = new Buffer(length * 4);
	    this.pos = 0;
	    reader._pos += 4;
	}

	var len = this.buffer.length;

	while (this.pos < len) {
	    if (reader._pos >= limit) { return false; }
	    var needed = this.buffer.length - this.pos;
	    var avail = limit - reader._pos;
	    var toCopy = (needed < avail) ? needed : avail;
	    buffer.copy(this.buffer, this.pos, reader._pos, reader._pos + toCopy);
	    this.pos += toCopy;
	    reader._pos += toCopy;
	}
    }

    return IntArrayHelper;
});

AddTypeHelper(TAG_TYPE_INT, function() {
    var IntHelper = function() { };
    IntHelper.prototype.createEntry = function(reader, id) {
	return { id : id, type : TAG_TYPE_INT, value : this.value };
    }
    IntHelper.prototype.consume = function(reader, buffer, limit) {
	var pos = reader._pos;
	if (pos + 4 > limit) { return false; }
	this.value = buffer.readInt32BE(pos);
	reader._pos += 4;
    }
    return IntHelper;
});

AddTypeHelper(TAG_TYPE_SHORT, function() {
    var ShortHelper = function() { };
    ShortHelper.prototype.createEntry = function(reader, id) {
	return { id : id, type : TAG_TYPE_SHORT, value : this.value };
    }
    ShortHelper.prototype.consume = function(reader, buffer, limit) {
	var pos = reader._pos;
	if (pos + 2 > limit) { return false; }
	this.value = buffer.readInt16BE(pos);
	reader._pos += 2;
    }
    return ShortHelper;
});

AddTypeHelper(TAG_TYPE_BYTE, function() {
    var ByteHelper = function() { };
    ByteHelper.prototype.createEntry = function(reader, id) {
	return { id : id, type : TAG_TYPE_BYTE, value : this.value };
    }
    ByteHelper.prototype.consume = function(reader, buffer, limit) {
	var pos = reader._pos;
	if (pos + 1 > limit) { return false; }
	this.value = buffer[pos]
	reader._pos += 1;
    }
    return ByteHelper;
});


AddTypeHelper(TAG_TYPE_DOUBLE, function() {
    var DoubleHelper = function() { };
    DoubleHelper.prototype.createEntry = function(reader, id) {
	return { id : id, type : TAG_TYPE_DOUBLE, value : this.value };
    }
    DoubleHelper.prototype.consume = function(reader, buffer, limit) {
	var pos = reader._pos;
	if (pos + 8 > limit) { return false; }
	this.value = buffer.readDoubleBE(pos);
	reader._pos += 8;
    }
    return DoubleHelper;
});

AddTypeHelper(TAG_TYPE_FLOAT, function() {
    var FloatHelper = function() { };
    FloatHelper.prototype.createEntry = function(reader, id) {
	return { id : id, type : TAG_TYPE_FLOAT, value : this.value };
    }
    FloatHelper.prototype.consume = function(reader, buffer, limit) {
	var pos = reader._pos;
	if (pos + 4 > limit) { return false; }
	this.value = buffer.readFloatBE(pos);
	reader._pos += 4;
    }
    return FloatHelper;
});

AddTypeHelper(TAG_TYPE_LONG, function() {
    var LongHelper = function() { };
    LongHelper.prototype.createEntry = function(reader, id) {
	return { id : id, type : TAG_TYPE_LONG, value : this.value };
    }
    LongHelper.prototype.consume = function(reader, buffer, limit) {
	var pos = reader._pos;
	if (pos + 8 > limit) { return false; }
	var hiVal = buffer.readInt32BE(pos);
	var loVal = buffer.readInt32BE(pos + 4);
	// TODO worry about overflow??
	this.value = hiVal << 32 + loVal;
	reader._pos += 8;
    }
    return LongHelper;
});

AddTypeHelper(TAG_TYPE_STRING, function() {
    var StringHelper = function() { };
    StringHelper.prototype.createEntry = function(reader, id) {
	return { id : id, type : TAG_TYPE_STRING, value : this.value };
    }
    StringHelper.prototype.consume = function(reader, buffer, limit) {
	var str = reader._readString();
	if (str == null) { return false; }
	this.value = str;
    }
    return StringHelper;
});

TagReader.prototype._consume = function() {
    var buffer = this._buffer;
    var limit = this._limit;
    var helpers = this._helpers;
    var child = null;

    while (true) {
	var helper;
	if (helpers.length == 0) {
	    var pending = this._pending;
	    if (this._curtask) {
		pending.shift();
	    }
	    if (pending.length == 0) {
		this._curtask = false;
		return this._pos >= limit;
	    }
	    helper = pending[0];
	    this._curtask = true;
	    child = null;
	} else {
	    helper = helpers.pop();
	}
	while (true) {
	    /*util.log("Invoking helper: " + helper
		     + "; child: " + child + " " + JSON.stringify(child)
		     + "; pos: " + this._pos + "; limit: " + limit);   */
	    var next = helper.consume(this, buffer, limit, child);
	    if (next === false) { 
		// Stall
		helpers.push(helper);
		if (this._ended) {
		    this._fail('EOF during parse');
		    return false;
		}
		this.emit('drain');
		// WE WANT MORE!
		return true;
	    } else if (next != null) {
		helpers.push(helper);
		helper = next;
		child = null;
	    } else {
		child = helper;
		helper = null;
		/*util.log("Helper returned: " + child + " " + JSON.stringify(child));  */
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
    this._curtask = false;
    this.writable = false;
    while (this._pending.length > 1) {
	var handler = this._pending.shift();
	handler.error(error);
    }
    this.emit('error', 'Failed');
}

var ReadValueHelper = function(callback) {
    this.callback = callback;
}

ReadValueHelper.prototype.consume = function(reader, buffer, limit, child) {
    if (child) {
	this.callback(null, child.value);
	return;
    }
    if (reader._pos >= reader._limit) {
	if (reader._ended) {
	    this.callback(null, null);
	    return;
	}
	return false;
    }
    return new ReadNamedTagHelper();
}

ReadValueHelper.prototype.error = function(err) {
    this.callback(err);
}

ReadValueHelper.prototype.toString = function() { return "ReadValueHelper"; }

TagReader.prototype.readValue = function(callback) {
    if (this._failed) {
	callback(this._failed);
	return;
    }
    if (this._ended && this._pos >= this._limit) {
	callback(null, null);
	return;
    }
    this._pending.push(new ReadValueHelper(callback));
    if (this._pending.length == 1) {
	this._consume();
    }
}

var ReadObjectHelper = function(callback) {
    this.callback = callback;
}

ReadObjectHelper.prototype.consume = function(reader, buffer, limit, child) {
    if (child) {
	var value = child.value;
	if (value == null) {
	    this.callback(null);
	} else {
	    this.callback(null, value.value, value);
	}
	return;
    }
    if (reader._pos >= reader._limit) {
	if (reader._ended) {
	    this.callback(null, null);
	    return;
	}
	return false;
    }
    var nextTagType = buffer[reader._pos];
    if (nextTagType != TAG_TYPE_OBJECT.id) {
	reader._fail(new Error("Expected object, got tag type " + nextTagType));
	return;
    }
    return new ReadNamedTagHelper();
}

ReadObjectHelper.prototype.error = function(err) {
    this.callback(err);
}

ReadObjectHelper.prototype.toString = function() { return "ReadObjectHelper"; }

TagReader.prototype.readObject = function(callback) {
    if (this._failed) {
	callback(this._failed);
	return;
    }
    if (this._ended && this._pos >= this._limit) {
	callback(null);
	return;
    }
    var helper = new ReadObjectHelper(callback);
    this._pending.push(helper);
    if (this._pending.length == 1) {
	this._consume();
    }
}

exports.TagReader = TagReader;
