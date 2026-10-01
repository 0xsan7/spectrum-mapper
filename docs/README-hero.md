# Hero GIF: how to record one

There is no demo GIF in this repository, and the README says so in a comment
where the image would go. This file is the recipe for replacing that comment
with a real recording.

## Why there is no GIF

A README that shows a demo it does not have is the same problem as a
performance claim that was never measured. An animated image of nothing would
just be a lie in a different format, so the placeholder image was deleted
rather than shipped. The comment stays until there is something real to put
there.

## Recording one

1. Start the app:

   ```sh
   npm start
   ```

2. Drive Chrome through the states worth showing — drag a transmitter, raise
   the exponent slider until coverage collapses, draw a wall across the room
   so it casts a shadow, and watch the position estimate track the mobile
   device.

3. Record, keeping it small so the front page stays readable:

   ```sh
   # macOS: 5 seconds at 20fps, scaled to 800px wide
   ffmpeg -f avfoundation -framerate 20 -capture_cursor 0 \
     -i "1:none" -t 5 -vf "fps=20,scale=800:-1:flags=lanczos" \
     spectrum-mapper.gif
   ```

4. Commit `spectrum-mapper.gif` at the repository root.

5. Delete the explanatory comment from the top of `README.md` and put the image
   in its place:

   ```html
   <p align="center">
     <img
       src="spectrum-mapper.gif"
       alt="Spectrum Mapper in action"
       width="100%"
     />
   </p>
   ```

6. Delete this file, and drop the `README-hero.md` comment from
   `scripts/gen-tree.js` so the generated tree in `docs/tree.md` stops listing
   it.

## Suggested content

Roughly in this order: the default heatmap; a transmitter being dragged; the
exponent slider raised so coverage visibly collapses; a wall drawn across the
room casting a shadow; and finally the trilateration crosshair tracking the
mobile device with its error shown in metres. That sequence shows the three
things the project does — model, edit, estimate — in about five seconds.
