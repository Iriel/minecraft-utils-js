minecraft-utils-js
==================

Javascript Utilities for Minecraft File Interaction

minecraft-tagio
---------------

This module provides reading (FUTURE: and writing) of the tagged binary structure used by Minecraft for serialization.
The primary means of interaction is via the ``TagReader`` object, which can be used as a ``Writable Stream`` and then
asked for data.

The ``TagReader.readObject(callback)`` method requests a single Object value from the reader. The callback will be invoked
with arguments ``(err, object, name)`` where name is the tag name from the stream (usually an empty string). If both ``err``
and ``object`` are null then the end of the stream has been reached.

The ``TagReader.readValue(callback)`` method provides a lower level requeststhe next tagged value from the reader. The callback will be invoked
with arguments ``(err, valueData)`` where the valueData is an array of the form ``[ name, [ type, value ]]``, or null if
the end of the stream has been reached.

Although the read methods execute asynchronously, they will be serviced in the order they are received.

