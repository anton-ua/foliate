/*
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */

const { GObject, Gio, GLib, Gtk, Gdk, GdkPixbuf, WebKit2 } = imports.gi
const ByteArray = imports.byteArray
const { Storage, Obj, base64ToPixbuf } = imports.utils
const { Window } = imports.window
const { uriStore } = imports.uriStore

const listBooks = function* (path) {
    const dir = Gio.File.new_for_path(path)
    if (!GLib.file_test(path, GLib.FileTest.EXISTS)) return
    const children = dir.enumerate_children('standard::name,time::modified',
        Gio.FileQueryInfoFlags.NONE, null)

    let info
    while ((info = children.next_file(null)) != null) {
        try {
            const name = info.get_name()
            const child = dir.get_child(name)
            const [success, data, tag] = child.load_contents(null)
            const json = JSON.parse(data instanceof Uint8Array
                ? ByteArray.toString(data) : data.toString())

            yield {
                identifier: decodeURIComponent(name.replace(/\.json$/, '')),
                metadata: json.metadata,
                progress: json.progress,
                modified: new Date(info.get_attribute_uint64('time::modified') * 1000)
            }
        } catch (e) {
            continue
        }
    }
}

const BookBoxChild =  GObject.registerClass({
    GTypeName: 'FoliateBookBoxChild',
    Properties: {
        entry: GObject.ParamSpec.object('entry', 'entry', 'entry',
            GObject.ParamFlags.READWRITE | GObject.ParamFlags.CONSTRUCT_ONLY, Obj.$gtype),
    }
}, class BookBoxChild extends Gtk.FlowBoxChild {
    _init(params) {
        super._init(params)
        this._image = new Gtk.Image({
            visible: true,
            halign: Gtk.Align.CENTER,
            valign: Gtk.Align.END
        })
        this.add(this._image)

        const { title } = this.entry.value
        this._image.tooltip_text = title
    }
    loadCover(pixbuf) {
        const width = 120
        const ratio = width / pixbuf.get_width()
        if (ratio < 1) {
            const height = parseInt(pixbuf.get_height() * ratio, 10)
            this._image.set_from_pixbuf(pixbuf
                .scale_simple(width, height, GdkPixbuf.InterpType.BILINEAR))
        } else this._image.set_from_pixbuf(pixbuf)
        this._image.get_style_context().add_class('foliate-book-image')
    }
})

const makeAcquisitionButton = (links, onActivate) => {
    const rel = links[0].rel.split('/').pop()
    let label = _('Get This Book')
    switch (rel) {
        case 'buy': label = _('Buy'); break
        case 'open-access': label = _('Free'); break
        case 'sample': label = _('Sample'); break
        case 'borrow': label = _('Borrow'); break
        case 'subscribe': label = _('Subscribe'); break
    }
    if (links.length === 1) {
        const button = new Gtk.Button({ visible: true, label })
        button.connect('clicked', () => onActivate(links[0]))
        return button
    } else {
        const popover = new Gtk.PopoverMenu()
        const box = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            margin: 10
        })
        const titleBox = new Gtk.Box({
            spacing: 6
        })
        const title = new Gtk.Label({ label: _('Choose a file:') })
        title.get_style_context().add_class('dim-label')
        titleBox.pack_start(new Gtk.Separator({ valign: Gtk.Align.CENTER }), true, true, 0)
        titleBox.pack_start(title, false, true, 0)
        titleBox.pack_start(new Gtk.Separator({ valign: Gtk.Align.CENTER }), true, true, 0)
        box.pack_start(titleBox, false, true, 0)
        box.show_all()
        popover.add(box)
        const button = new Gtk.MenuButton({ popover })
        const buttonBox = new Gtk.Box()
        const icon = new Gtk.Image({ icon_name: 'pan-down-symbolic' })
        buttonBox.pack_start(new Gtk.Label({ label }), true, true, 0)
        buttonBox.pack_end(icon, false, true, 0)
        button.add(buttonBox)
        button.show_all()
        links.forEach(link => {
            const mimetype = link.type
            const menuItem = new Gtk.ModelButton({
                visible: true,
                text: Gio.content_type_get_description(mimetype),
                tooltip_text: mimetype
            })
            menuItem.connect('clicked', () => onActivate(link))
            box.pack_start(menuItem, false, true, 0)
        })
        return button
    }
}

const BookInfoBox =  GObject.registerClass({
    GTypeName: 'FoliateBookInfoBox',
    Template: 'resource:///com/github/johnfactotum/Foliate/ui/bookInfoBox.ui',
    InternalChildren: [
        'title', 'summary', 'authors', 'acquisitionBox',
    ],
    Properties: {
        entry: GObject.ParamSpec.object('entry', 'entry', 'entry',
            GObject.ParamFlags.READWRITE | GObject.ParamFlags.CONSTRUCT_ONLY, Obj.$gtype),
    }
}, class BookInfoBox extends Gtk.Box {
    _init(params) {
        super._init(params)
        const {
            title = '',
            summary = '',
            authors = [],
            links = []
        } = this.entry.value
        this._title.label = title
        this._summary.label = summary
        this._authors.label = authors.map(x => x.name).join(', ')

        const map = new Map()
        links.filter(x => x.rel.startsWith('http://opds-spec.org/acquisition'))
            .forEach(x => {
                if (!map.has(x.rel)) map.set(x.rel, [x])
                else map.get(x.rel).push(x)
            })
        Array.from(map.values()).forEach((links, i) => {
            const button = makeAcquisitionButton(links, ({ type, href }) => {
                // open in a browser
                // Gtk.show_uri_on_window(null, href, Gdk.CURRENT_TIME)
                // Gio.AppInfo.launch_default_for_uri(href, null)

                // or, open with app directly
                const appInfo = Gio.AppInfo.get_default_for_type(type, true)
                appInfo.launch_uris([href], null)
            })
            if (i === 0) button.get_style_context().add_class('suggested-action')
            this._acquisitionBox.pack_start(button, false, true, 0)
        })
        if (map.size === 2) {
            this._acquisitionBox.orientation = Gtk.Orientation.HORIZONTAL
            this._acquisitionBox.homogeneous = true
        }
    }
})

const BookListRow =  GObject.registerClass({
    GTypeName: 'FoliateBookListRow',
    Template: 'resource:///com/github/johnfactotum/Foliate/ui/bookListRow.ui',
    InternalChildren: [
        'title', 'creator',
        'progressGrid', 'progressBar', 'progressLabel',
        'remove'
    ],
    Properties: {
        book: GObject.ParamSpec.object('book', 'book', 'book',
            GObject.ParamFlags.READWRITE | GObject.ParamFlags.CONSTRUCT_ONLY, Obj.$gtype),
    }
}, class BookListRow extends Gtk.ListBoxRow {
    _init(params, removeFunc) {
        super._init(params)
        this._removeFunc = removeFunc
        const { progress, metadata: { title, creator } } = this.book.value
        this._title.label = title || ''
        this._creator.label = creator || ''
        if (progress) {
            const fraction = (progress[0] + 1) / (progress[1] + 1)
            this._progressBar.fraction = fraction
            this._progressLabel.label = Math.round(fraction * 100) + '%'
            // this._progressLabel.label = `${(progress[0] + 1)} / ${(progress[1] + 1)}`
            const bookSize = Math.min((progress[1] + 1) / 1500, 0.8)
            const steps = 20
            const span = Math.round(bookSize * steps) + 1
            this._progressGrid.child_set_property(this._progressBar, 'width', span)
            this._progressGrid.child_set_property(this._progressLabel, 'width', steps - span)
            this._progressGrid.child_set_property(this._progressLabel, 'left-attach', span)
        } else this._progressGrid.hide()

        this._remove.connect('clicked', this.remove.bind(this))
    }
    remove() {
        const window = this.get_toplevel()
        const msg = new Gtk.MessageDialog({
            text: _('Are you sure you want to remove this book?'),
            secondary_text: _('Reading progress, annotations, and bookmarks will be permanently lost.'),
            message_type: Gtk.MessageType.WARNING,
            modal: true,
            transient_for: window
        })
        msg.add_button(_('Cancel'), Gtk.ResponseType.CANCEL)
        msg.add_button(_('Remove'), Gtk.ResponseType.ACCEPT)
        msg.set_default_response(Gtk.ResponseType.CANCEL)
        msg.get_widget_for_response(Gtk.ResponseType.ACCEPT)
            .get_style_context().add_class('destructive-action')
        const res = msg.run()
        if (res === Gtk.ResponseType.ACCEPT) {
            const id = this.book.value.metadata.identifier
            this._removeFunc(id)
            uriStore.delete(id)
            Gio.File.new_for_path(Storage.getPath('data', id)).delete(null)
            Gio.File.new_for_path(Storage.getPath('cache', id)).delete(null)
        }
        msg.close()
    }
})

var BookListBox = GObject.registerClass({
    GTypeName: 'FoliateBookListBox'
}, class BookListBox extends Gtk.ListBox {
    _init(params) {
        super._init(params)
        this.set_header_func((row) => {
            if (row.get_index()) row.set_header(new Gtk.Separator())
        })
        this._list = new Gio.ListStore()
        const removeFunc = id => {
            const n = this._list.get_n_items()
            for (let i = 0; i < n; i++) {
                if (this._list.get_item(i).value.metadata.identifier === id) {
                    this._list.remove(i)
                    break
                }
            }
        }
        this.bind_model(this._list, book => new BookListRow({ book }, removeFunc))

        const datadir = GLib.build_filenamev([GLib.get_user_data_dir(), pkg.name])
        const books = listBooks(datadir)
        Array.from(books)
            .filter(x => x.metadata)
            .sort((a, b) => b.modified - a.modified)
            .forEach(x => {
                this._list.append(new Obj(x))
            })

        this.connect('row-activated', (box, row) => {
            const id = row.book.value.metadata.identifier
            const uri = uriStore.get(id)
            if (!uri) {
                const window = this.get_toplevel()
                const msg = new Gtk.MessageDialog({
                    text: _('File location unkown'),
                    secondary_text: _('Choose the location of this file to open it.'),
                    message_type: Gtk.MessageType.QUESTION,
                    buttons: Gtk.ButtonsType.OK_CANCEL,
                    modal: true,
                    transient_for: window
                })
                msg.set_default_response(Gtk.ResponseType.OK)
                const res = msg.run()
                if (res === Gtk.ResponseType.OK)
                    window.application.lookup_action('open').activate(null)
                msg.close()
                return
            }
            const file = Gio.File.new_for_uri(uri)
            this.get_toplevel().open(file)
        })

        const cssProvider = new Gtk.CssProvider()
        cssProvider.load_from_data(`progress, trough { min-width: 1px; }`)
        Gtk.StyleContext.add_provider_for_screen(
            Gdk.Screen.get_default(),
            cssProvider,
            Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION)
    }
})

const htmlPath = pkg.pkgdatadir + '/assets/opds.html'
class OpdsClient {
    constructor() {
        this._resolveMap = new Map()
        this._rejecteMap = new Map()

        this._webView = new WebKit2.WebView({
            settings: new WebKit2.Settings({
                enable_write_console_messages_to_stdout: true,
                allow_file_access_from_file_urls: true,
                allow_universal_access_from_file_urls: true,
                enable_developer_extras: true
            })
        })
        const contentManager = this._webView.get_user_content_manager()
        contentManager.connect('script-message-received::action', (_, jsResult) => {
            const data = jsResult.get_js_value().to_string()
            const { type, payload, token } = JSON.parse(data)
            switch (type) {
                case 'ready':
                    this._resolveMap.get('ready')()
                    break
                case 'error':
                    this._rejectMap.get('ready')()
                    break
                case 'feed': {
                    this._resolveMap.get(token)(payload)
                    break
                }
                case 'image': {
                    const pixbuf = base64ToPixbuf(payload)
                    this._resolveMap.get(token)(pixbuf)
                    break
                }
            }
        })
        contentManager.register_script_message_handler('action')
        this._webView.load_uri(GLib.filename_to_uri(htmlPath, null))
    }
    _run(script) {
        this._webView.run_javascript(script, null, () => {})
    }
    init() {
        return new Promise((resolve, reject) => {
            this._resolveMap.set('ready', resolve)
            this._rejecteMap.set('ready', reject)
        })
    }
    get(uri) {
        this._run(`getFeed(decodeURI("${encodeURI(uri)}"))`)
        return new Promise((resolve, reject) => {
            this._resolveMap.set(uri, resolve)
            this._rejecteMap.set(uri, reject)
        })
    }
    getImage(uri) {
        this._run(`getImage(decodeURI("${encodeURI(uri)}"))`)
        return new Promise((resolve, reject) => {
            this._resolveMap.set(uri, resolve)
            this._rejecteMap.set(uri, reject)
        })
    }
}

var LibraryWindow =  GObject.registerClass({
    GTypeName: 'FoliateLibraryWindow',
    Template: 'resource:///com/github/johnfactotum/Foliate/ui/libraryWindow.ui',
    InternalChildren: [
        'stack', 'storeBookBox',
    ],
}, class LibraryWindow extends Gtk.ApplicationWindow {
    _init(params) {
        super._init(params)
        this.show_menubar = false
        this.title = _('Foliate')

        this._storeBookBox.connect('child-activated', (flowbox, child) => {
            const popover = new Gtk.Popover({
                relative_to: child,
                width_request: 320,
                height_request: 320
            })
            const infoBox = new BookInfoBox({
                entry: child.entry,
            })
            popover.add(infoBox)
            popover.popup()
        })

        this._storeLoaded = false
        this._stack.connect('notify::visible-child-name', () => {
            if (this._stack.visible_child_name === 'store') {
                if (this._storeLoaded) return

                const client = new OpdsClient()
                client.init().then(() => {
                    const map = new Map()
                    client.get('https://standardebooks.org/opds/all')
                        .then(feed => {
                            const list = new Gio.ListStore()
                            const entries = feed.entries.slice(0, 20)
                            entries.forEach((entry, i) => {
                                entry.i = i
                                list.append(new Obj(entry))
                                const thumbnail = entry.links
                                    .find(x => x.rel === 'http://opds-spec.org/image/thumbnail')
                                if (thumbnail)
                                    client.getImage(thumbnail.href).then(pixbuf => {
                                        const child = map.get(i)
                                        if (child) child.loadCover(pixbuf)
                                    })
                            })
                            this._storeBookBox.bind_model(list, entry => {
                                const child = new BookBoxChild({ entry })
                                map.set(entry.value.i, child)
                                return child
                            })
                            this._storeLoaded = true
                        })
                }).catch(e => {
                    logError(e)
                })
            }
        })
    }
    open(file) {
        new Window({ application: this.application, file}).present()
        this.close()
    }
})