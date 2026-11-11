# Pin Screenshot

Pin screenshots above application windows for reference and comparison, using GNOME's native screenshot tool. Pins appear at the captured position and on-screen size, can be dragged across the desktop, and support Ctrl+scroll zoom.

## Install from source

Requires GNU Make, Node.js, Python 3, GLib's `glib-compile-schemas`, and `gnome-extensions`. Node.js and Python are used for build checks, not while the extension runs.

Clone the repository and install:

```sh
git clone https://github.com/naiiren/pin-screenshot.git
cd pin-screenshot
make install
```

Log out and back in so GNOME discovers the extension, then:

```sh
gnome-extensions enable pin-screenshot@naiiren
```