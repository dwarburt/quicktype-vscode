"use strict";

import * as vscode from "vscode";
import { Range } from "vscode";
import { paste as pasteCallback } from "copy-paste";
import {
    quicktype,
    languages,
    languageNamed,
    SerializedRenderResult,
    JSONTypeSource,
    SchemaTypeSource,
    TypeSource,
    TypeScriptTypeSource
} from "quicktype";

import * as analytics from "./analytics";

enum Command {
    PasteJSONAsTypes = "quicktype.pasteJSONAsTypes",
    PasteJSONAsTypesAndSerialization = "quicktype.pasteJSONAsTypesAndSerialization",
    PasteSchemaAsTypes = "quicktype.pasteJSONSchemaAsTypes",
    PasteSchemaAsTypesAndSerialization = "quicktype.pasteJSONSchemaAsTypesAndSerialization",
    PasteTypeScriptAsTypesAndSerialization = "quicktype.pasteTypeScriptAsTypesAndSerialization"
}

async function paste(): Promise<string> {
    return new Promise<string>((pass, fail) => {
        pasteCallback((err, content) => (err ? fail(err) : pass(content)));
    });
}

function jsonIsValid(json: string) {
    try {
        JSON.parse(json);
    } catch (e) {
        return false;
    }
    return true;
}

async function promptTopLevelName(): Promise<{ cancelled: boolean; name: string }> {
    let topLevelName = await vscode.window.showInputBox({
        prompt: "Top-level type name?"
    });

    return {
        cancelled: topLevelName === undefined,
        name: topLevelName || "TopLevel"
    };
}

async function getTargetLanguage(editor: vscode.TextEditor): Promise<{ cancelled: boolean; name: string }> {
    const documentLanguage = editor.document.languageId;
    const currentLanguage = languageNamed(documentLanguage);
    if (currentLanguage !== undefined) {
        return {
            cancelled: false,
            name: currentLanguage.displayName
        };
    }

    const languageChoices = languages.map(l => l.displayName).sort();
    const chosenName = await vscode.window.showQuickPick(languageChoices);
    return {
        cancelled: chosenName === undefined,
        name: chosenName || "types"
    };
}

async function pasteAsTypes(editor: vscode.TextEditor, kind: "json" | "schema" | "typescript", justTypes: boolean) {
    let indentation: string;
    if (editor.options.insertSpaces) {
        const tabSize = editor.options.tabSize as number;
        indentation = " ".repeat(tabSize);
    } else {
        indentation = "\t";
    }

    const language = await getTargetLanguage(editor);
    if (language.cancelled) {
        return;
    }

    const content = await paste();
    if (kind !== "typescript" && !jsonIsValid(content)) {
        vscode.window.showErrorMessage("Clipboard does not contain valid JSON.");
        return;
    }

    const rendererOptions = {};
    if (justTypes) {
        rendererOptions["just-types"] = "true";
        rendererOptions["features"] = "just-types";
    }

    const topLevelName = await promptTopLevelName();
    if (topLevelName.cancelled) {
        return;
    }

    let source = {
        json: {
            kind: "json",
            name: topLevelName.name,
            samples: [content]
        } as JSONTypeSource,

        schema: {
            kind: "schema",
            name: topLevelName.name,
            schema: content
        } as SchemaTypeSource,

        typescript: {
            kind: "typescript",
            sources: {
                [`${topLevelName.name}.ts`]: content
            }
        } as TypeScriptTypeSource
    }[kind] as TypeSource | undefined;

    if (source === undefined) {
        vscode.window.showErrorMessage(`Unrecognized input format: ${kind}`);
        return;
    }

    analytics.sendEvent(`paste ${kind}`, language.name);

    let result: SerializedRenderResult;
    try {
        result = await quicktype({
            lang: language.name,
            sources: [source],
            leadingComments: ["Generated by https://quicktype.io"],
            rendererOptions,
            indentation
        });
    } catch (e) {
        // TODO Invalid JSON produces an uncatchable exception from quicktype
        // Fix this so we can catch and show an error message.
        vscode.window.showErrorMessage(e);
        return;
    }

    const text = result.lines.join("\n");
    const selection = editor.selection;
    editor.edit(builder => {
        if (selection.isEmpty) {
            builder.insert(selection.start, text);
        } else {
            builder.replace(new Range(selection.start, selection.end), text);
        }
    });
}

export function activate(context: vscode.ExtensionContext) {
    analytics.initialize(context);

    context.subscriptions.push(
        vscode.commands.registerTextEditorCommand(Command.PasteJSONAsTypes, editor =>
            pasteAsTypes(editor, "json", true)
        ),
        vscode.commands.registerTextEditorCommand(Command.PasteJSONAsTypesAndSerialization, editor =>
            pasteAsTypes(editor, "json", false)
        ),
        vscode.commands.registerTextEditorCommand(Command.PasteSchemaAsTypes, editor =>
            pasteAsTypes(editor, "schema", true)
        ),
        vscode.commands.registerTextEditorCommand(Command.PasteSchemaAsTypesAndSerialization, editor =>
            pasteAsTypes(editor, "schema", false)
        ),
        vscode.commands.registerTextEditorCommand(Command.PasteTypeScriptAsTypesAndSerialization, editor =>
            pasteAsTypes(editor, "typescript", false)
        )
    );
}

export function deactivate(): void {
    return;
}
