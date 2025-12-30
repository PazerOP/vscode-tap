const vscode = require('vscode');

// Regex to match test results - handles both "ok 1 - desc" and "ok 1 desc" formats
const TEST_RESULT_REGEX = /^(\s*)(ok|not ok)\s+(\d+)(?:\s+(?:-\s+)?(.*))?/;
const TEST_PLAN_REGEX = /^(\s*)(\d+)\.\.(\d+)$/;

/**
 * TAP Folding Provider
 * Provides folding for test results (to hide comments below) and YAML blocks
 */
class TapFoldingProvider {
    provideFoldingRanges(document, context, token) {
        const foldingRanges = [];
        const lines = document.getText().split('\n');

        let currentTestLine = -1;
        let currentTestIndent = 0;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmedLine = line.trim();

            // Check for test result line
            const testMatch = line.match(TEST_RESULT_REGEX);
            if (testMatch) {
                // Close previous test's folding range if there were comment lines
                if (currentTestLine >= 0 && i > currentTestLine + 1) {
                    foldingRanges.push(new vscode.FoldingRange(currentTestLine, i - 1));
                }
                currentTestLine = i;
                currentTestIndent = testMatch[1].length;
                continue;
            }

            // Check for test plan (also ends previous test's fold)
            const planMatch = line.match(TEST_PLAN_REGEX);
            if (planMatch) {
                if (currentTestLine >= 0 && i > currentTestLine + 1) {
                    foldingRanges.push(new vscode.FoldingRange(currentTestLine, i - 1));
                }
                currentTestLine = -1;
                continue;
            }

            // Check for YAML block start
            if (trimmedLine === '---') {
                for (let j = i + 1; j < lines.length; j++) {
                    if (lines[j].trim() === '...') {
                        foldingRanges.push(new vscode.FoldingRange(i, j, vscode.FoldingRangeKind.Region));
                        break;
                    }
                }
            }
        }

        // Close final test's folding range
        if (currentTestLine >= 0 && lines.length > currentTestLine + 1) {
            foldingRanges.push(new vscode.FoldingRange(currentTestLine, lines.length - 1));
        }

        return foldingRanges;
    }
}

/**
 * Parse TAP content and extract test results
 */
function parseTapContent(text) {
    const lines = text.split('\n');
    const tests = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        const match = line.match(TEST_RESULT_REGEX);
        if (match) {
            const indent = match[1].length;
            const passed = match[2] === 'ok';
            const testNumber = parseInt(match[3], 10);
            const rest = match[4] || '';

            // Check for directives
            const hasTodo = /# TODO/i.test(line);
            const hasSkip = /# SKIP/i.test(line);

            // Extract description (remove directive comments)
            let description = rest.replace(/#.*$/, '').trim() || `Test ${testNumber}`;

            // Extract duration if present (e.g., "in 304ms", "in 1.5s")
            let duration = undefined;
            const durationMatch = description.match(/\s+in\s+(\d+(?:\.\d+)?)(ms|s)\s*$/i);
            if (durationMatch) {
                const value = parseFloat(durationMatch[1]);
                const unit = durationMatch[2].toLowerCase();
                duration = unit === 's' ? value * 1000 : value;
                description = description.replace(/\s+in\s+\d+(?:\.\d+)?(?:ms|s)\s*$/i, '').trim();
            }

            tests.push({
                line: i,
                indent,
                passed,
                testNumber,
                description,
                duration,
                hasTodo,
                hasSkip,
                fullLine: line
            });
        }
    }

    return tests;
}

/**
 * TAP Test Provider
 * Shows test results in the Test Explorer
 */
class TapTestProvider {
    constructor() {
        this.controller = vscode.tests.createTestController('tapTests', 'TAP Tests');
        this.testItems = new Map();

        this.controller.resolveHandler = async (item) => {
            if (!item) {
                await this.discoverAllTests();
            }
        };

        this.controller.refreshHandler = async () => {
            await this.discoverAllTests();
        };
    }

    async discoverAllTests() {
        this.controller.items.replace([]);
        this.testItems.clear();

        for (const document of vscode.workspace.textDocuments) {
            if (document.languageId === 'tap') {
                await this.updateTestsForDocument(document);
            }
        }
    }

    async updateTestsForDocument(document) {
        const uri = document.uri;
        const fileName = uri.path.split('/').pop();

        let fileItem = this.controller.items.get(uri.toString());
        if (!fileItem) {
            fileItem = this.controller.createTestItem(uri.toString(), fileName, uri);
            this.controller.items.add(fileItem);
        }

        const tests = parseTapContent(document.getText());

        fileItem.children.replace([]);

        const run = this.controller.createTestRun(
            new vscode.TestRunRequest([fileItem]),
            'TAP Results',
            false
        );

        for (const test of tests) {
            const testId = `${uri.toString()}#${test.testNumber}`;
            const testItem = this.controller.createTestItem(
                testId,
                `${test.testNumber}: ${test.description}`,
                uri
            );
            testItem.range = new vscode.Range(
                new vscode.Position(test.line, test.indent),
                new vscode.Position(test.line, test.fullLine.length)
            );

            fileItem.children.add(testItem);
            this.testItems.set(testId, testItem);

            if (test.hasSkip) {
                run.skipped(testItem);
            } else if (test.hasTodo) {
                if (test.passed) {
                    run.passed(testItem, test.duration);
                } else {
                    run.skipped(testItem);
                }
            } else if (test.passed) {
                run.passed(testItem, test.duration);
            } else {
                run.failed(testItem, new vscode.TestMessage(`Test failed: ${test.description}`), test.duration);
            }
        }

        run.end();
    }

    removeTestsForDocument(uri) {
        this.controller.items.delete(uri.toString());
    }

    dispose() {
        this.controller.dispose();
    }
}

/**
 * Activates the extension
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
    const foldingProvider = new TapFoldingProvider();
    context.subscriptions.push(
        vscode.languages.registerFoldingRangeProvider(
            { language: 'tap' },
            foldingProvider
        )
    );

    const testProvider = new TapTestProvider();
    context.subscriptions.push(testProvider);

    context.subscriptions.push(
        vscode.workspace.onDidOpenTextDocument((document) => {
            if (document.languageId === 'tap') {
                testProvider.updateTestsForDocument(document);
            }
        })
    );

    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument((event) => {
            if (event.document.languageId === 'tap') {
                testProvider.updateTestsForDocument(event.document);
            }
        })
    );

    context.subscriptions.push(
        vscode.workspace.onDidCloseTextDocument((document) => {
            if (document.languageId === 'tap') {
                testProvider.removeTestsForDocument(document.uri);
            }
        })
    );

    for (const document of vscode.workspace.textDocuments) {
        if (document.languageId === 'tap') {
            testProvider.updateTestsForDocument(document);
        }
    }
}

function deactivate() {}

module.exports = {
    activate,
    deactivate
};
