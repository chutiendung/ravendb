﻿import app = require("durandal/app");
import system = require("durandal/system");
import router = require("plugins/router");
import appUrl = require("common/appUrl");
import ace = require("ace/ace");

import viewModelBase = require("viewmodels/viewModelBase");
import shell = require("viewmodels/shell");
import getConfigurationCommand = require("commands/filesystem/getConfigurationCommand");
import filesystem = require("models/filesystem/filesystem");
import configurationKey = require("models/filesystem/configurationKey");
import changeSubscription = require('models/changeSubscription');
import aceEditorBindingHandler = require("common/aceEditorBindingHandler");
import messagePublisher = require("common/messagePublisher");
import Pair = require("common/pair");
import messagePublisher = require("common/messagePublisher");

class configuration extends viewModelBase {

    static configSelector = "#settingsContainer";
    private router = router;

    appUrls: computedAppUrls;

    keys = ko.observableArray<configurationKey>();
    text: KnockoutComputed<string>;
    selectedKey = ko.observable<configurationKey>().subscribeTo("ActivateConfigurationKey").distinctUntilChanged();
    selectedKeyValue = ko.observable<Pair<string, string>>();
    currentKey = ko.observable<configurationKey>();
    configurationEditor: AceAjax.Editor;
    configurationKeyText = ko.observable<string>('').extend({ required: true });
    isBusy = ko.observable(false);
    isSaveEnabled: KnockoutComputed<boolean>;
    editor: AceAjax.Editor;
    
    constructor() {
        super();
        aceEditorBindingHandler.install();
        this.selectedKey.subscribe(k => this.selectedKeyChanged(k));

        // When we programmatically change a configuration doc, push it into the editor.
        //this.subscription = this.configurationKeyText.subscribe(() => this.updateConfigurationText());
        this.text = ko.computed({
            read: () => {
                return this.configurationKeyText();
            },
            write: (text: string) => {
                this.configurationKeyText(text);
            },
            owner: this
        });
    }

    activate(navigationArgs) {
        super.activate(navigationArgs);

        this.appUrls = appUrl.forCurrentFilesystem();

        this.dirtyFlag = new ko.DirtyFlag([this.configurationKeyText]);

        this.isSaveEnabled = ko.computed(() => this.dirtyFlag().isDirty());
    }

    attached() {
/*        this.activeFilesystem.subscribe(x => {
            this.loadKeys(x);
        });*/

        (<any>$('.keys-collection')).contextmenu({
            target: '#keys-context-menu'
        });

        this.loadKeys(this.activeFilesystem());
        this.initializeDocEditor();
        this.configurationEditor.focus();
        this.setupKeyboardShortcuts();
    }

    compositionComplete() {
        super.compositionComplete();

        var editorElement = $("#configurationEditor");
        if (editorElement.length > 0) {
            this.editor = ko.utils.domData.get(editorElement[0], "aceEditor");
        }
        this.focusOnEditor();
    }

    detached() {
        super.detached();
        this.selectedKey.unsubscribeFrom("ActivateConfigurationKey");
    }

    private focusOnEditor() {
        if (!!this.editor) {
            this.editor.focus();
        }
    }

    createNotifications(): Array<changeSubscription> {
        return [ shell.currentResourceChangesApi().watchFsConfig((e: filesystemConfigNotification) => this.processFsConfigNotification(e)) ];
    }

    processFsConfigNotification(e: filesystemConfigNotification) {
        switch (e.Action) {
            case filesystemConfigurationChangeAction.Set:
                this.addKey(e.Name);
                break;
            case filesystemConfigurationChangeAction.Delete:
                this.removeKey(e.Name);
                break;
            default:
                console.error("Unknown notification action.");
        }
    }

    setupKeyboardShortcuts() {
        //this.createKeyboardShortcut("alt+shift+d", () => this.currentKey(), editDocument.editDocSelector);
        //this.createKeyboardShortcut("alt+shift+m", () => this.focusOnMetadata(), editDocument.editDocSelector);
        //this.createKeyboardShortcut("alt+c", () => this.focusOnEditor(), editDocument.editDocSelector);
        //this.createKeyboardShortcut("alt+home", () => this.firstDocument(), editDocument.editDocSelector);
        //this.createKeyboardShortcut("alt+end", () => this.lastDocument(), editDocument.editDocSelector);
        //this.createKeyboardShortcut("alt+page-up", () => this.previousDocumentOrLast(), editDocument.editDocSelector);
        //this.createKeyboardShortcut("alt+page-down", () => this.nextDocumentOrFirst(), editDocument.editDocSelector);
        this.createKeyboardShortcut("alt+shift+del", () => this.deleteConfiguration(), configuration.configSelector);
    }

    initializeDocEditor() {
        // Startup the Ace editor with JSON syntax highlighting.
        // TODO: Just use the simple binding handler instead.
        this.configurationEditor = ace.edit("configurationEditor");
        this.configurationEditor.setTheme("ace/theme/xcode");
        this.configurationEditor.setFontSize("16px");
        this.configurationEditor.getSession().setMode("ace/mode/json");
    }

    updateConfigurationText() {
        if (this.configurationEditor) {
            this.configurationEditor.getSession().setValue(this.configurationKeyText());
        }
    }

    loadKeys(fs: filesystem){
        new getConfigurationCommand(fs)
            .execute()
            .done( (x: configurationKey[]) => {
                this.keys(x);
                if (x.length > 0) {
                    this.selectKey(x[0]);
                }
            });
    }

    selectKey(key: configurationKey) {
        key.activate();
        router.navigate(appUrl.forFilesystemConfigurationWithKey(this.activeFilesystem(), key.key));
    }

    selectedKeyChanged(selected: configurationKey) {
        if (selected) {
            this.isBusy(true);
            selected.getValues().done(data => {
                this.configurationKeyText(data);
            }).always(() => {
                this.dirtyFlag().reset();
                this.isBusy(false);
            });

            this.currentKey(selected);
            this.focusOnEditor();
        }
    }

    selectKeyValue(selection: Pair<string, string>) {
        this.selectedKeyValue(selection);
    }

    save() {
        var message = "";
        try {
            var jsonConfigDoc = JSON.parse(this.configurationKeyText());
        } catch (e) {
            if (jsonConfigDoc == undefined) {
                message = "The configuration key data isn't a legal JSON expression!";
            }
            this.focusOnEditor();
        }
        if (message != "") {
            messagePublisher.reportError(message, undefined, undefined, false);
            return;
        }

        require(["commands/filesystem/saveConfigurationCommand"], saveConfigurationCommand => {
            var saveCommand = new saveConfigurationCommand(this.activeFilesystem(), this.currentKey(), jsonConfigDoc);
            var saveTask = saveCommand.execute();
            saveTask.done(() => this.dirtyFlag().reset());
        });
    }

    refreshConfig() {
        this.selectKey(this.currentKey());
    }

    deleteConfiguration() {
        require(["viewmodels/filesystem/deleteConfigurationKeys"], deleteConfigurationKeys => {
            var deleteConfigurationKeyViewModel = new deleteConfigurationKeys(this.activeFilesystem(), [this.currentKey()]);
            deleteConfigurationKeyViewModel
                .deletionTask
                .done(() => {
                    this.removeKey(this.currentKey().key);
                });
            app.showDialog(deleteConfigurationKeyViewModel);
        });
    }

    removeKey(key: string) {
        var foundKey = this.keys().filter((x: configurationKey) => { return (x.key == key) });

        if (foundKey.length > 0) {
            var currentIndex = this.keys.indexOf(this.currentKey());
            var foundIndex = this.keys.indexOf(foundKey[0]);
            var newIndex = currentIndex;
            if (currentIndex + 1 == this.keys().length) {
                newIndex = currentIndex - 1;
            }

            this.keys.remove(foundKey[0]);
            if (this.keys()[newIndex] && currentIndex == foundIndex) {
                this.selectKey(this.keys()[newIndex]);
            }
        }
    }

    addKey(key: string) {
        var foundKey = this.keys.first((configKey: configurationKey) => configKey.key == key);

        if (!foundKey) {
            var newKey = new configurationKey(this.activeFilesystem(), key);
            this.keys.push(newKey);
            return newKey;
        }

        return foundKey;
    }

    newConfigurationKey() {
        require(["viewmodels/filesystem/createConfigurationKey", "commands/filesystem/saveConfigurationCommand"], (createConfigurationKey, saveConfigurationCommand) => {
            var createConfigurationKeyViewModel = new createConfigurationKey(this.keys());
            createConfigurationKeyViewModel
                .creationTask
                .done((key: string) => {
                    new saveConfigurationCommand(this.activeFilesystem(), new configurationKey(this.activeFilesystem(), key), JSON.parse("{}")).execute()
                        .done(() => {
                            var newKey = this.addKey(key);
                            this.selectKey(newKey);
                        })
                        .fail((qXHR, textStatus, errorThrown) => messagePublisher.reportError("Could not create Configuration Key!", errorThrown));
                });
            app.showDialog(createConfigurationKeyViewModel);
        });
    }
} 

export = configuration;