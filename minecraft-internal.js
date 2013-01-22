// Minecraft Stuff
//
// Internal functions, used in the construction of the other parts, but not really
// worthy of public consumption

function notifyPending(obj, property) {
    var callbacks = obj[property];
    if (callbacks == null) { return; }
    obj[property] = null;

    var argsArray = Array.prototype.slice.call(arguments, 2);
    for (var i = 0; i < callbacks.length; ++i) {
	var cb = callbacks[i];
	if (cb != null) { cb.apply(null, argsArray); }
    }
}

exports.notifyPending = notifyPending;

