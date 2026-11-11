import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import Gdk from 'gi://Gdk';
import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class PinScreenshotPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        const page = new Adw.PreferencesPage({title: 'Pin Screenshot', icon_name: 'camera-photo-symbolic'});
        window.add(page);
        const general = new Adw.PreferencesGroup({title: 'Capture and controls'});
        page.add(general);
        for (const [key, title, subtitle] of [
            ['show-panel-icon', 'Show panel icon', 'Settings remain available through the Extensions app.'],
            ['auto-pin', 'Pin native screenshots automatically', 'The capture shortcut always pins its capture, even when this is off.'],
        ]) {
            const row = new Adw.SwitchRow({title, subtitle});
            settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
            general.add(row);
        }
        const shortcutRow = new Adw.ActionRow({title: 'Capture and pin shortcut',
            subtitle: 'Click to record a key combination. Escape cancels; Backspace disables.'});
        const shortcutButton = new Gtk.Button({valign: Gtk.Align.CENTER});
        const updateLabel = () => {
            const shortcut = settings.get_strv('pin-shortcut')[0];
            if (!shortcut) {
                shortcutButton.label = 'Disabled';
                return;
            }
            const [valid, key, mods] = Gtk.accelerator_parse(shortcut);
            shortcutButton.label = valid ? Gtk.accelerator_get_label(key, mods) : shortcut;
        };
        updateLabel();
        shortcutButton.connect('clicked', () => this._recordShortcut(window, settings, updateLabel));
        shortcutRow.add_suffix(shortcutButton);
        shortcutRow.activatable_widget = shortcutButton;
        general.add(shortcutRow);
        const appearance = new Adw.PreferencesGroup({title: 'Appearance',
            description: 'Changes apply immediately to existing pins. The border is drawn inside the image to preserve capture alignment.'});
        page.add(appearance);
        const shadow = new Adw.SwitchRow({title: 'Show window shadow',
            subtitle: 'Draw a soft shadow around pinned screenshots.'});
        settings.bind('show-shadow', shadow, 'active', Gio.SettingsBindFlags.DEFAULT);
        appearance.add(shadow);
        for (const [key, title, lower, upper] of [
            ['image-opacity', 'Image opacity (%)', 10, 100],
            ['border-opacity', 'Border opacity (0 = transparent, 100 = opaque)', 0, 100],
            ['border-width', 'Border width (pixels)', 1, 8],
        ]) {
            const row = new Adw.SpinRow({title, adjustment: new Gtk.Adjustment({
                lower, upper, step_increment: 1, page_increment: 10,
            })});
            settings.bind(key, row, 'value', Gio.SettingsBindFlags.DEFAULT);
            appearance.add(row);
        }
    }

    _recordShortcut(parent, settings, onChange) {
        const dialog = new Gtk.Window({title: 'Set capture shortcut', transient_for: parent,
            modal: true, default_width: 420, default_height: 180, resizable: false});
        const label = new Gtk.Label({label: 'Press your shortcut now.\nEscape cancels · Backspace disables',
            wrap: true, margin_top: 24, margin_bottom: 24, margin_start: 24, margin_end: 24});
        dialog.set_child(label);
        const controller = new Gtk.EventControllerKey();
        controller.set_propagation_phase(Gtk.PropagationPhase.CAPTURE);
        controller.connect('key-pressed', (_controller, keyval, _keycode, state) => {
            if (keyval === Gdk.KEY_Escape) {
                dialog.close();
                return true;
            }
            if (keyval === Gdk.KEY_BackSpace || keyval === Gdk.KEY_Delete) {
                settings.set_strv('pin-shortcut', []);
                onChange();
                dialog.close();
                return true;
            }
            if ([Gdk.KEY_Control_L, Gdk.KEY_Control_R, Gdk.KEY_Shift_L, Gdk.KEY_Shift_R,
                Gdk.KEY_Alt_L, Gdk.KEY_Alt_R, Gdk.KEY_Super_L, Gdk.KEY_Super_R,
                Gdk.KEY_Meta_L, Gdk.KEY_Meta_R, Gdk.KEY_Caps_Lock, Gdk.KEY_Num_Lock].includes(keyval))
                return true;
            const modifiers = state & Gtk.accelerator_get_default_mod_mask();
            if (!Gtk.accelerator_valid(keyval, modifiers)) {
                label.label = 'This combination cannot be used. Try another shortcut.';
                return true;
            }
            settings.set_strv('pin-shortcut', [Gtk.accelerator_name(keyval, modifiers)]);
            onChange();
            dialog.close();
            return true;
        });
        dialog.add_controller(controller);
        dialog.present();
    }

}
