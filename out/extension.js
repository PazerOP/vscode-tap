const vscode = require('vscode');

/**
 * TAP Folding Provider
 * Provides syntax-aware folding for TAP files based on test plans and subtests
 */
class TapFoldingProvider {
    provideFoldingRanges(document, context, token) {
        const foldingRanges = [];
        const lines = document.getText().split('\n');
        const stack = []; // Stack to track nested test suites

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmedLine = line.trim();
            const indentation = line.length - line.trimStart().length;

            // Match test plan (e.g., "1..4")
            const planMatch = trimmedLine.match(/^(\d+)\.\.(\d+)$/);
            if (planMatch) {
                // Close any previous ranges at same or deeper indentation
                while (stack.length > 0 && stack[stack.length - 1].indent >= indentation) {
                    const prev = stack.pop();
                    if (prev.startLine < i - 1) {
                        foldingRanges.push(new vscode.FoldingRange(prev.startLine, i - 1));
                    }
                }
                // Start a new folding range for this test plan
                stack.push({ startLine: i, indent: indentation });
                continue;
            }

            // Match YAML block start (---)
            if (trimmedLine === '---') {
                // Find the end of the YAML block (...)
                for (let j = i + 1; j < lines.length; j++) {
                    if (lines[j].trim() === '...') {
                        foldingRanges.push(new vscode.FoldingRange(i, j, vscode.FoldingRangeKind.Region));
                        break;
                    }
                }
            }
        }

        // Close any remaining open ranges
        while (stack.length > 0) {
            const prev = stack.pop();
            if (prev.startLine < lines.length - 1) {
                foldingRanges.push(new vscode.FoldingRange(prev.startLine, lines.length - 1));
            }
        }

        return foldingRanges;
    }
}

/**
 * TAP Diagnostics Provider
 * Provides problem diagnostics for failed tests (not ok)
 */
class TapDiagnosticsProvider {
    constructor() {
        this.diagnosticCollection = vscode.languages.createDiagnosticCollection('tap');
    }

    updateDiagnostics(document) {
        if (document.languageId !== 'tap') {
            return;
        }

        const diagnostics = [];
        const lines = document.getText().split('\n');

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];

            // Match "not ok" test results
            const notOkMatch = line.match(/^(\s*)(not ok)\s+(\d+)(?:\s+-\s+(.*))?/);
            if (notOkMatch) {
                const indent = notOkMatch[1].length;
                const testNumber = notOkMatch[3];
                const description = notOkMatch[4] || `Test ${testNumber}`;

                // Check for TODO or SKIP directives (these are not failures)
                const hasTodo = /# TODO/i.test(line);
                const hasSkip = /# SKIP/i.test(line);

                if (!hasTodo && !hasSkip) {
                    const range = new vscode.Range(
                        new vscode.Position(i, indent),
                        new vscode.Position(i, line.length)
                    );

                    const diagnostic = new vscode.Diagnostic(
                        range,
                        `Test failed: ${description.replace(/#.*$/, '').trim()}`,
                        vscode.DiagnosticSeverity.Error
                    );
                    diagnostic.source = 'TAP';
                    diagnostic.code = `not-ok-${testNumber}`;

                    diagnostics.push(diagnostic);
                } else if (hasTodo) {
                    // TODO tests are warnings, not errors
                    const range = new vscode.Range(
                        new vscode.Position(i, indent),
                        new vscode.Position(i, line.length)
                    );

                    const diagnostic = new vscode.Diagnostic(
                        range,
                        `TODO: ${description.replace(/#.*$/, '').trim()}`,
                        vscode.DiagnosticSeverity.Warning
                    );
                    diagnostic.source = 'TAP';
                    diagnostic.code = `todo-${testNumber}`;

                    diagnostics.push(diagnostic);
                }
            }
        }

        this.diagnosticCollection.set(document.uri, diagnostics);
    }

    clearDiagnostics(document) {
        this.diagnosticCollection.delete(document.uri);
    }

    dispose() {
        this.diagnosticCollection.dispose();
    }
}

/**
 * Activates the extension
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
    // Register folding provider
    const foldingProvider = new TapFoldingProvider();
    context.subscriptions.push(
        vscode.languages.registerFoldingRangeProvider(
            { language: 'tap' },
            foldingProvider
        )
    );

    // Register diagnostics provider
    const diagnosticsProvider = new TapDiagnosticsProvider();
    context.subscriptions.push(diagnosticsProvider);

    // Update diagnostics when document opens
    context.subscriptions.push(
        vscode.workspace.onDidOpenTextDocument((document) => {
            if (document.languageId === 'tap') {
                diagnosticsProvider.updateDiagnostics(document);
            }
        })
    );

    // Update diagnostics when document changes
    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument((event) => {
            if (event.document.languageId === 'tap') {
                diagnosticsProvider.updateDiagnostics(event.document);
            }
        })
    );

    // Clear diagnostics when document closes
    context.subscriptions.push(
        vscode.workspace.onDidCloseTextDocument((document) => {
            if (document.languageId === 'tap') {
                diagnosticsProvider.clearDiagnostics(document);
            }
        })
    );

    // Update diagnostics for already open documents
    vscode.workspace.textDocuments.forEach((document) => {
        if (document.languageId === 'tap') {
            diagnosticsProvider.updateDiagnostics(document);
        }
    });
}

/**
 * Deactivates the extension
 */
function deactivate() {}

module.exports = {
    activate,
    deactivate
};
