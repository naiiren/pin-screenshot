import Clutter from 'gi://Clutter';
import Cogl from 'gi://Cogl';
import GdkPixbuf from 'gi://GdkPixbuf';
import Gio from 'gi://Gio';
import St from 'gi://St';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

// ScreenshotUI emits before closing; copy geometry before its selectors reset.
function captureGeometry(ui) {
    if (ui._selectionButton.checked || ui._screenButton.checked) {
        const [x, y, width, height] = ui._getSelectedGeometry(false);
        return {x, y, width, height};
    }
    const selected = ui._windowSelectors.flatMap(selector => selector.windows())
        .find(window => window.checked);
    if (!selected)
        throw new Error('No selected screenshot window');
    // Native window captures contain the buffer, including transparent shadows.
    const rect = selected.child._bufferRect;
    return {x: rect.x, y: rect.y, width: rect.width, height: rect.height};
}

class Pin {
    constructor(pixbuf, geometry, onClose) {
        this._onClose = onClose;
        this._sourceWidth = geometry.width;
        this._sourceHeight = geometry.height;
        this._scale = 1;
        this.actor = new St.Widget({
            style_class: 'pin-screenshot', reactive: true, track_hover: true,
            can_focus: false, clip_to_allocation: false,
        });
        // Explicitly bounded shadow geometry participates in Clutter damage tracking.
        // Avoid a CSS blur painted outside the moving actor's allocation.
        this._shadow = new St.Widget({reactive: false});
        this.actor.add_child(this._shadow);
        this._shadowLayers = [];
        for (let i = 0; i < 12; i++) {
            const layer = new St.Widget({reactive: false,
                style: 'background-color: rgba(0, 0, 0, 0.035); border-radius: 12px;'});
            this._shadow.add_child(layer);
            this._shadowLayers.push(layer);
        }
        const content = St.ImageContent.new_with_preferred_size(pixbuf.width, pixbuf.height);
        content.set_bytes(global.stage.context.get_backend().get_cogl_context(),
            pixbuf.read_pixel_bytes(), pixbuf.has_alpha
                ? Cogl.PixelFormat.RGBA_8888 : Cogl.PixelFormat.RGB_888,
            pixbuf.width, pixbuf.height, pixbuf.rowstride);
        this._picture = new St.Widget({content, reactive: true});
        this.actor.add_child(this._picture);
        // Draw the border over the image so it never changes capture alignment.
        this._border = new St.Widget({reactive: false});
        this.actor.add_child(this._border);
        this._close = new St.Button({
            style_class: 'pin-screenshot-close', accessible_name: 'Close pinned screenshot',
            child: new St.Icon({icon_name: 'window-close-symbolic', icon_size: 16}),
            can_focus: false, opacity: 0, reactive: false,
        });
        this._closeId = this._close.connect('clicked', () => this.destroy());
        this.actor.add_child(this._close);
        this._hoverId = this.actor.connect('notify::hover', () => {
            this._close.opacity = this.actor.hover ? 255 : 0;
            this._close.reactive = this.actor.hover;
        });
        this._resize(1);
        this.actor.set_position(geometry.x, geometry.y);

        const drag = new Clutter.PanGesture();
        drag.set_begin_threshold(4);
        const recognizeId = drag.connect('recognize', () => {
            const point = drag.get_centroid_abs();
            this._dragOrigin = [point.x, point.y, this.actor.x, this.actor.y];
            Main.uiGroup.set_child_below_sibling(this.actor, global.top_window_group);
        });
        const panId = drag.connect('pan-update', () => {
            const point = drag.get_centroid_abs();
            const [x, y, originX, originY] = this._dragOrigin;
            // Move a single texture at integer coordinates; no shadows, clones,
            // animations, or image uploads in the motion path.
            this.actor.set_position(Math.round(originX + point.x - x),
                Math.round(originY + point.y - y));
        });
        this._picture.add_action(drag);
        this._releaseDrag = () => {
            drag.disconnect(recognizeId);
            drag.disconnect(panId);
            this._picture.remove_action(drag);
        };
        this._scrollId = this._picture.connect('scroll-event', (_actor, event) => {
            if (!(event.get_state() & Clutter.ModifierType.CONTROL_MASK))
                return Clutter.EVENT_PROPAGATE;
            let delta;
            switch (event.get_scroll_direction()) {
            case Clutter.ScrollDirection.UP: delta = -1; break;
            case Clutter.ScrollDirection.DOWN: delta = 1; break;
            case Clutter.ScrollDirection.SMOOTH: [, delta] = event.get_scroll_delta(); break;
            default: return Clutter.EVENT_STOP;
            }
            const [x, y] = event.get_coords();
            const oldScale = this._scale;
            this._resize(oldScale * Math.exp(-delta * 0.12));
            const ratio = this._scale / oldScale;
            this.actor.set_position(Math.round(x - (x - this.actor.x) * ratio),
                Math.round(y - (y - this.actor.y) * ratio));
            return Clutter.EVENT_STOP;
        });
        Main.layoutManager.addChrome(this.actor, {trackFullscreen: false});
    }

    _resize(scale) {
        this._scale = Math.max(0.05, Math.min(8, scale));
        const width = Math.max(1, Math.round(this._sourceWidth * this._scale));
        const height = Math.max(1, Math.round(this._sourceHeight * this._scale));
        this.actor.set_size(width, height);
        this._picture.set_size(width, height);
        this._shadow.set_position(-24, -20);
        this._shadow.set_size(width + 48, height + 48);
        this._shadowLayers.forEach((layer, index) => {
            const inset = index * 2;
            layer.set_position(inset, inset);
            layer.set_size(width + 48 - inset * 2, height + 48 - inset * 2);
        });
        this._border.set_size(width, height);
        const closeSize = Math.min(28, width, height);
        this._close.set_size(closeSize, closeSize);
        this._close.set_position(width - closeSize, 0);
    }

    applySettings(settings) {
        this._shadow.visible = settings.get_boolean('show-shadow');
        this._picture.opacity = Math.round(settings.get_int('image-opacity') * 255 / 100);
        const alpha = settings.get_int('border-opacity') / 100;
        const width = settings.get_int('border-width');
        this._border.set_style(`border: ${width}px solid rgba(255, 255, 255, ${alpha});`);
    }

    destroy() {
        if (!this.actor)
            return;
        this._close.disconnect(this._closeId);
        this.actor.disconnect(this._hoverId);
        this._picture.disconnect(this._scrollId);
        this._releaseDrag();
        this._releaseDrag = null;
        this._dragOrigin = null;
        Main.layoutManager.removeChrome(this.actor);
        // Explicit child cleanup also makes ownership clear to static reviewers.
        this._close.destroy();
        this._close = null;
        this._border.destroy();
        this._border = null;
        this._picture.destroy();
        this._picture = null;
        for (const layer of this._shadowLayers)
            layer.destroy();
        this._shadow.destroy();
        this._shadow = null;
        this._shadowLayers = null;
        this.actor.destroy();
        this.actor = null;
        const onClose = this._onClose;
        this._onClose = null;
        onClose(this);
    }
}

export default class PinScreenshotExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._pinNext = false;
        this._pins = new Set();
        this._cancellable = new Gio.Cancellable();
        this._indicator = new PanelMenu.Button(0.0, 'Pin Screenshot');
        this._indicator.add_child(new St.Icon({icon_name: 'view-pin-symbolic',
            style_class: 'system-status-icon'}));
        this._captureSwitch = new PopupMenu.PopupSwitchMenuItem('Pin new screenshots', this._settings.get_boolean('auto-pin'));
        this._indicator.menu.addMenuItem(this._captureSwitch);
        this._captureToggleId = this._captureSwitch.connect('toggled', (_item, state) => {
            this._settings.set_boolean('auto-pin', state);
        });
        this._indicator.menu.addAction('Capture and pin…', () => this._captureAndPin());
        this._indicator.menu.addAction('Close all pins', () => this._closeAll());
        this._indicator.menu.addAction('Settings…', () => this.openPreferences());
        Main.panel.addToStatusArea(this.uuid, this._indicator);
        this._screenshotId = Main.screenshotUI.connect('screenshot-taken', (ui, file) => {
            const shouldPin = this._settings.get_boolean('auto-pin') || this._pinNext;
            this._pinNext = false;
            if (!shouldPin)
                return;
            try {
                this._loadPin(file, captureGeometry(ui), this._cancellable);
            } catch (error) {
                console.error(`${this.uuid}: ${error}`);
                Main.notify('Pin Screenshot', 'Could not determine the capture position.');
            }
        });
        this._closedId = Main.screenshotUI.connect('closed', () => { this._pinNext = false; });
        this._settingsId = this._settings.connect('changed', (_settings, key) => this._applySettings(key));
        this._applySettings();
        this._sessionId = Main.sessionMode.connect('updated', () => this._syncVisibility());
        this._monitorsId = Main.layoutManager.connect('monitors-changed', () => {
            // Keep controls reachable after unplugging a monitor.
            const monitor = Main.layoutManager.primaryMonitor;
            if (monitor) {
                for (const pin of this._pins)
                    pin.actor.set_position(monitor.x + 40, monitor.y + 70);
            }
        });
    }

    async _loadPin(file, geometry, cancellable) {
        try {
            const stream = await new Promise((resolve, reject) => {
                file.read_async(0, cancellable, (source, result) => {
                    try { resolve(source.read_finish(result)); } catch (error) { reject(error); }
                });
            });
            let pixbuf;
            try {
                // PNG decoding runs asynchronously instead of blocking Shell's UI thread.
                pixbuf = await new Promise((resolve, reject) => {
                    GdkPixbuf.Pixbuf.new_from_stream_async(stream, cancellable, (_source, result) => {
                        try { resolve(GdkPixbuf.Pixbuf.new_from_stream_finish(result)); }
                        catch (error) { reject(error); }
                    });
                });
            } finally {
                stream.close_async(0, null, (source, result) => {
                    try { source.close_finish(result); } catch (error) { console.error(error); }
                });
            }
            if (cancellable.is_cancelled())
                return;
            const pin = new Pin(pixbuf, geometry, closed => this._pins.delete(closed));
            this._pins.add(pin);
            pin.applySettings(this._settings);
            this._syncVisibility();
        } catch (error) {
            if (!cancellable.is_cancelled()) {
                console.error(`${this.uuid}: ${error}`);
                Main.notify('Pin Screenshot', 'Could not open the screenshot. See the Shell journal.');
            }
        }
    }

    async _captureAndPin() {
        if (Main.screenshotUI.visible)
            return;
        this._indicator.menu.close();
        this._pinNext = true;
        try {
            await Main.screenshotUI.open();
        } catch (error) {
            this._pinNext = false;
            console.error(`${this.uuid}: ${error}`);
        }
    }

    _applySettings(key = null) {
        this._indicator.visible = this._settings.get_boolean('show-panel-icon');
        this._captureSwitch.setToggleState(this._settings.get_boolean('auto-pin'));
        if (!key || ['show-shadow', 'image-opacity', 'border-opacity', 'border-width'].includes(key)) {
            for (const pin of this._pins)
                pin.applySettings(this._settings);
        }
        if (!key || key === 'pin-shortcut') {
            Main.wm.removeKeybinding('pin-shortcut');
            Main.wm.addKeybinding('pin-shortcut', this._settings, Meta.KeyBindingFlags.NONE,
                Shell.ActionMode.NORMAL, () => this._captureAndPin());
        }

    }

    _syncVisibility() {
        const visible = !Main.sessionMode.isLocked &&
            !Main.sessionMode.isGreeter;
        for (const pin of this._pins)
            pin.actor.visible = visible;
    }

    _closeAll() {
        for (const pin of [...this._pins])
            pin.destroy();
    }

    disable() {
        this._cancellable.cancel();
        this._settings.disconnect(this._settingsId);
        Main.wm.removeKeybinding('pin-shortcut');
        Main.screenshotUI.disconnect(this._closedId);
        Main.screenshotUI.disconnect(this._screenshotId);
        Main.sessionMode.disconnect(this._sessionId);
        Main.layoutManager.disconnect(this._monitorsId);
        this._closeAll();
        this._captureSwitch.disconnect(this._captureToggleId);
        this._captureSwitch.destroy();
        this._indicator.destroy();
        this._indicator = null;
        this._captureSwitch = null;
        this._cancellable = null;
        this._pins = null;
        this._settings = null;
    }
}
