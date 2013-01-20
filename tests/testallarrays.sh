#!/bin/sh

for i in `./testarrays.js`; do
    ./testarrays.js "$i"
done
