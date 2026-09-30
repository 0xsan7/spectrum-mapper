# Hero placeholder

`spectrum-mapper.gif` is referenced by the top-level README and is a
placeholder: it is not a recording of the app, because no recording has been
made yet.

The README shows a grey placeholder block in its place rather than implying a
demo exists. To replace it:

1. Start the app: `npm start`
2. Drive Chrome through a few states worth showing - drag a transmitter, move
   the exponent slider, draw a wall, watch the position estimate move.
3. Record to a GIF, keeping it under ~3 MB so the README stays readable:

   ```sh
   # macOS, 5s at 20fps, scaled to 800px wide
   ffmpeg -f avfoundation -framerate 20 -capture_cursor 0 \
     -i "1:none" -t 5 -vf "fps=20,scale=800:-1:flags=lanczos" \
     spectrum-mapper.gif
   ```

4. Commit the result at the repository root as `spectrum-mapper.gif` and
   delete this file and the placeholder block in the README.

Suggested content, roughly in this order: the default heatmap, a transmitter
being dragged, the exponent slider raised so coverage collapses, a wall drawn
across the room casting a shadow, then the trilateration crosshair tracking the
mobile device with its error in metres.

## Why a placeholder and not a real GIF

A README that shows a demo it does not have is the same problem as a
performance claim that was never measured. Both were removed from this
project's previous README for exactly this reason. The alternative - an
animated image of nothing - would just be a lie in a different format.
