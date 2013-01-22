minecraft-utils-js
==================

Javascript Utilities for Minecraft File Interaction

minecraft-tagio
---------------

This module provides reading (FUTURE: and writing) of the tagged
binary structure used by Minecraft for serialization.  The primary
means of interaction is via the ``TagReader`` object, which can be
used as a ``Writable Stream`` and then asked for data.

Tag Types
---------

The types of serialized values are represented by instances of the
``tagio.TagType`` object. Users are not expected to create these directly, but
instead use the constants and methods provided. Each type has the following
properties..

**``id``** - The numeric tag type identifier from the minecraft format

**``label``** - A readable String type label

**``entryType``** - For typed lists, the TagType of the list's contents

Each type also provides the following method:

**``getListType()``** - Gets the type representing a list of this type.

The following type constants are defined:

    tagio.TAG_TYPE_END         // Object end marker
    tagio.TAG_TYPE_BYTE        // 8 bit integer value
    tagio.TAG_TYPE_SHORT       // 16 bit integer value
    tagio.TAG_TYPE_INT         // 32 bit integer value
    tagio.TAG_TYPE_LONG        // 64 bit integer value (ish)
    tagio.TAG_TYPE_FLOAT       // 32 bit floating point value
    tagio.TAG_TYPE_DOUBLE      // 64 bit double precision floating point value
    tagio.TAG_TYPE_BYTE_ARRAY  // Array of bytes
    tagio.TAG_TYPE_INT_ARRAY   // Array of (32 bit) integers
    tagio.TAG_TYPE_STRING      // UTF-8 String
    tagio.TAG_TYPE_LIST        // List of typed values
    tagio.TAG_TYPE_OBJECT      // Object of named, typed, values

The ``TAG_TYPE_LIST`` constant has no entry type.

Function: tagTypes = tagio.getTagTypes()
----------------------------------------

* ``tagTypes`` - An array containing the standard tag types.

Gets all of the standard tag types.

Function: tagType = tagio.tagTypeForId(id)
----------------------------------------

* ``id`` - The numeric tag type identifier from the minecraft format.
* ``tagType`` - The tag type for that id, or null if unknown

Gets the tag type for a specific tag id.


Tagged Values and Entries
-------------------------

The tagged data structure stores all values with an associated type, in addition
many values occur in the context of an object container and as such have an identifier.
The exception is values appearing in a list, in which case the list carries the type of
all values and they are effectively anonymous. The combination of identifier, type, and
value is referred to in this library as an **entry**, and takes the following form:

    entry = { id : "foo", type : tagio.TAG_TYPE_STRING, value : "Bar" }

Class: TagReader
----------------
Provides a writable ``Stream`` object from which deserialized values can be requested. The
request methods operate asynchronously but are processed in the order they are invoked.

Typically used in conjunction with zlib as the various data files are compressed on disk.

    readStream = fs.createReadStream(null, {fd : fd});
    tagReader = readStream.pipe(zlib.createGunzip()).pipe(new tagio.TagReader());
    tagReader.readObject(callback);

new TagReader( [ { options } ] )
--------------------------------

Constructs a new tag reader instance, optionally configured with the specified
options object. Within the options the following properties can be provided, default
values will be used for any that are not specified.

**``objectFactory : function(id, entries)``** - Provides a function to create an entry
for an "object" tag. The ``id`` parameter is the id of the object within its parent,
and ``entries`` is an array of the entries for this object. The result must be an
entry. The default implementation uses a new ``tagio.SimpleTaggedObject`` instance
constructed from ``entries`` as the entry value.

**``listFactory : function(id, entryType, values)``** - Provides a function to create an
entry for a "list" tag. The ``id`` parameter is the id of the list within its parent,
``entryType`` is the type of entry in the list, and ``values`` is an array of the values
within the list. The result must be an entry. The default implementation uses the
``values`` array as the entry value.

**``byteArrayFactory : function(id, buffer)``** - Provides a function to create an
entry for a "byte array" tag. The ``id`` parameter is the id of the list within its parent,
and ``buffer`` is a Buffer object containing the data. The result must be an entry. The
default implementation uses the buffer as the entry value.

**``intArrayFactory : function(id, buffer)``** - Provides a function to create an
entry for a "int array" tag. The ``id`` parameter is the id of the list within its parent,
and ``buffer`` is a Buffer object containing the data as big-endian 32 bit values.
The result must be an entry. The default implementation uses the buffer as the entry
value.

reader.readObject(callback)
---------------------------

Reads the next entry from the stream, ensuring that it is an "Object".

* **``callback(err, value, entry)``** - Invoked upon completion with the object value
  read (for convenience) and also the complete entry containing that value. If there is
  no more data available then ``value`` will be null.

reader.readEntry(callback)
---------------------------

Reads the next entry from the stream.

* **``callback(err, entry)``** - Invoked upon completion with the entry read.
  If there is no more data available then ``value`` will be null.

Interface: TaggedObject
-----------------------

The following methods are expected to be provided by javascript Objects that represent
the minecraft tagged object when interacting with this library.

entries = tagobj.getEntries()
-----------------------------

* ``entries`` - Array of entry objects.

Gets the list of entries for this object

entry = tagobj.getEntry(id)
-----------------------------

* ``id`` - The entry identifier requested
* ``entry`` - The entry for the identifier, or null if there is no match



Class: SimpleTaggedObject
-------------------------

Provides a read-only javascript Object representation of a tagged minecraft object. For
simple use one need not overly worry about the details, simply interact with the
object as if it were a native javascript object.

new SimpleTaggedObject(entries)
-------------------------------

* ``entries`` - Array of entry objects.

Constructs a new object constructed from the entries provided. No validation is performed
for uniqueness or sanity. Each of the entries becomes a property in the object using the
entry's ``id`` as the key and the entry's ``value`` as the value.

entries = tagobj.getEntries()
-----------------------------

* ``entries`` - Array of entry objects.

Gets the list of entries for this object. The object returned should not be modified.

entry = tagobj.getEntry(id)
-----------------------------

* ``id`` - The entry identifier requested
* ``entry`` - The entry for the identifier, or null if there is no match

Gets the entry for a particular entry identifier. The object returned should not be modified.

tagType = tagobj.getType(id)
-----------------------------

* ``id`` - The entry identifier requested
* ``tagType`` - The tag type for the identifier, or null if there is no match.

Gets the type for a particular entry identifier.

value = tagobj.getValue(id)
-----------------------------

* ``id`` - The entry identifier requested
* ``value`` - The value for the identifier, or null if there is no match

Gets the value for a particular entry identifier.



Future Required Features
------------------------

* A TagWriter with which to create streams from data
* A robust writable object implementation (likely has to be an "entry map" of some
  description)
* Improved stream state handling after error

