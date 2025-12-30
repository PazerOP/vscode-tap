const vscode = require('vscode');

// Regex patterns
const TEST_RESULT_REGEX = /^(\s*)(ok|not ok)\s+(\d+)(?:\s+(?:-\s+)?(.*))?/;
const TEST_PLAN_REGEX = /^(\s*)(\d+)\.\.(\d+)$/;

/**
 * TAP Folding Provider
 */
class TapFoldingProvider {
    provideFoldingRanges(document, context, token) {
        const foldingRanges = [];
        const lines = document.getText().split('\n');

        let currentTestLine = -1;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmedLine = line.trim();

            const testMatch = line.match(TEST_RESULT_REGEX);
            if (testMatch) {
                if (currentTestLine >= 0 && i > currentTestLine + 1) {
                    foldingRanges.push(new vscode.FoldingRange(currentTestLine, i - 1));
                }
                currentTestLine = i;
                continue;
            }

            const planMatch = line.match(TEST_PLAN_REGEX);
            if (planMatch) {
                if (currentTestLine >= 0 && i > currentTestLine + 1) {
                    foldingRanges.push(new vscode.FoldingRange(currentTestLine, i - 1));
                }
                currentTestLine = -1;
                continue;
            }

            if (trimmedLine === '---') {
                for (let j = i + 1; j < lines.length; j++) {
                    if (lines[j].trim() === '...') {
                        foldingRanges.push(new vscode.FoldingRange(i, j, vscode.FoldingRangeKind.Region));
                        break;
                    }
                }
            }
        }

        if (currentTestLine >= 0 && lines.length > currentTestLine + 1) {
            foldingRanges.push(new vscode.FoldingRange(currentTestLine, lines.length - 1));
        }

        return foldingRanges;
    }
}

/**
 * Parse TAP content into groups and tests with output
 */
function parseTapContent(text) {
    const lines = text.split('\n');
    const groups = [];
    let currentGroup = null;
    let currentTest = null;
    let lastTestNumber = 0;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Check for test plan (starts a new group)
        const planMatch = line.match(TEST_PLAN_REGEX);
        if (planMatch) {
            // Save current test's output before starting new group
            if (currentGroup) {
                groups.push(currentGroup);
            }
            currentGroup = {
                name: `Tests ${planMatch[2]}..${planMatch[3]}`,
                line: i,
                tests: []
            };
            currentTest = null;
            lastTestNumber = 0;
            continue;
        }

        // Check for test result
        const testMatch = line.match(TEST_RESULT_REGEX);
        if (testMatch) {
            const indent = testMatch[1].length;
            const passed = testMatch[2] === 'ok';
            const testNumber = parseInt(testMatch[3], 10);
            const rest = testMatch[4] || '';

            // Detect new group if test number resets
            if (testNumber <= lastTestNumber && currentGroup && currentGroup.tests.length > 0) {
                groups.push(currentGroup);
                currentGroup = {
                    name: `Tests (group ${groups.length + 1})`,
                    line: i,
                    tests: []
                };
            }

            // Create group if none exists
            if (!currentGroup) {
                currentGroup = {
                    name: 'Tests',
                    line: i,
                    tests: []
                };
            }

            const hasTodo = /# TODO/i.test(line);
            const hasSkip = /# SKIP/i.test(line);

            let description = rest.replace(/#.*$/, '').trim() || `Test ${testNumber}`;

            // Extract duration
            let duration = undefined;
            const durationMatch = description.match(/\s+in\s+(\d+(?:\.\d+)?)(ms|s)\s*$/i);
            if (durationMatch) {
                const value = parseFloat(durationMatch[1]);
                const unit = durationMatch[2].toLowerCase();
                duration = unit === 's' ? value * 1000 : value;
                description = description.replace(/\s+in\s+\d+(?:\.\d+)?(?:ms|s)\s*$/i, '').trim();
            }

            currentTest = {
                line: i,
                indent,
                passed,
                testNumber,
                description,
                duration,
                hasTodo,
                hasSkip,
                fullLine: line,
                output: []
            };

            currentGroup.tests.push(currentTest);
            lastTestNumber = testNumber;
            continue;
        }

        // Any other line is output for the current test
        if (currentTest && line.trim()) {
            currentTest.output.push(line);
        }
    }

    // Don't forget the last group
    if (currentGroup) {
        groups.push(currentGroup);
    }

    return groups;
}

/**
 * TAP Test Provider
 */
class TapTestProvider {
    constructor() {
        this.controller = vscode.tests.createTestController('tapTests', 'TAP Tests');
        this.testItems = new Map();
        this.documents = new Map();

        // Add refresh handler so users can reload tests
        this.controller.refreshHandler = async () => {
            for (const document of this.documents.values()) {
                await this.updateTestsForDocument(document);
            }
        };
    }

    async updateTestsForDocument(document) {
        const uri = document.uri;
        const fileName = uri.path.split('/').pop();

        // Track document for refresh
        this.documents.set(uri.toString(), document);

        let fileItem = this.controller.items.get(uri.toString());
        if (!fileItem) {
            fileItem = this.controller.createTestItem(uri.toString(), fileName, uri);
            this.controller.items.add(fileItem);
        }

        const groups = parseTapContent(document.getText());

        fileItem.children.replace([]);
        const allTestItems = [];

        for (let groupIndex = 0; groupIndex < groups.length; groupIndex++) {
            const group = groups[groupIndex];

            // Create group item if multiple groups, otherwise add tests directly to file
            let parentItem;
            if (groups.length > 1) {
                const groupId = `${uri.toString()}#group${groupIndex}`;
                parentItem = this.controller.createTestItem(groupId, group.name, uri);
                parentItem.range = new vscode.Range(
                    new vscode.Position(group.line, 0),
                    new vscode.Position(group.line, 0)
                );
                fileItem.children.add(parentItem);
            } else {
                parentItem = fileItem;
            }

            for (const test of group.tests) {
                const testId = `${uri.toString()}#${groupIndex}:${test.line}`;
                const testItem = this.controller.createTestItem(
                    testId,
                    `${test.testNumber}: ${test.description}`,
                    uri
                );
                testItem.range = new vscode.Range(
                    new vscode.Position(test.line, test.indent),
                    new vscode.Position(test.line, test.fullLine.length)
                );

                parentItem.children.add(testItem);
                this.testItems.set(testId, testItem);
                allTestItems.push({ item: testItem, test });
            }
        }

        // Create test run
        const run = this.controller.createTestRun(
            new vscode.TestRunRequest(allTestItems.map(t => t.item)),
            'TAP Results',
            false
        );

        for (const { item, test } of allTestItems) {
            run.started(item);

            // Append output if any
            if (test.output.length > 0) {
                run.appendOutput(test.output.join('\r\n') + '\r\n', undefined, item);
            }

            if (test.hasSkip) {
                run.skipped(item);
            } else if (test.hasTodo) {
                if (test.passed) {
                    run.passed(item, test.duration);
                } else {
                    run.skipped(item);
                }
            } else if (test.passed) {
                run.passed(item, test.duration);
            } else {
                const message = new vscode.TestMessage(test.output.length > 0
                    ? test.output.join('\n')
                    : `Test failed: ${test.description}`);
                message.location = new vscode.Location(
                    item.uri,
                    new vscode.Position(test.line, test.indent)
                );
                run.failed(item, message, test.duration);
            }
        }

        run.end();
    }

    removeTestsForDocument(uri) {
        this.controller.items.delete(uri.toString());
        this.documents.delete(uri.toString());
    }

    dispose() {
        this.controller.dispose();
    }
}

/**
 * Activates the extension
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
