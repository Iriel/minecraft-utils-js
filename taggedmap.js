// ---------------------------------------------------------------------------

var TagTypedEnumeration = function(type, id, label, enumerableId) {
    if (enumerableId == null) { enumerableId = true; }
    Object.defineProperty(this, '_tagType', { value: type });
    Object.defineProperty(this, 'id', { enumerable: enumerableId, value: id });
    Object.defineProperty(this, 'label', { enumerable: true, value : label });
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
	var id = ent.id;
	Object.defineProperty(this, id, createPropertyMap(id));
	entryMap[id] = ent;
    }
}

TaggedMap.prototype.getValue = function(id) {
    var ent = this.__entryMap[id];
    var conv = ent.conv;
    if (conv != null) {
	return conv.onGet(ent.value, ent.type)
    } else {
	return ent.value;
    }
}

TaggedMap.prototype.setValue = function(id, val) {
    var ent = this.__entryMap[id];
    // TODO check type!!!!
    // TODO reverse conversion
    ent.value = val;
}

TaggedMap.prototype.getType = function(id) {
    var ent = this.__entryMap[id];
    return (ent == null) ? null : ent.type;
}

TaggedMap.prototype.getEntry = function(id) {
    return this.__entryMap[id];
}
TaggedMap.prototype.getEntries = function() {
    return this.__entries;
}

exports.TaggedMap = TaggedMap;

