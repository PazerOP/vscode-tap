# TAP for Visual Studio Code

This extension adds language support for [Test Anything Protocol](https://testanything.org/) files in Visual Studio Code.

## What This Extension Does

This extension provides **editor support for `.tap` files**, including:

- **Syntax highlighting** for TAP elements (version headers, test plans, ok/not ok results, comments, YAML blocks)
- **Code folding** for test suites and subtests
- **Comment toggling** using `Ctrl+/` (or `Cmd+/` on macOS)
- **Test Explorer integration** showing test results with pass/fail/skip status and duration

## How to Use

1. Install this extension from the VS Code Marketplace
2. Open any `.tap` file in VS Code
3. The extension automatically activates and provides syntax highlighting

### Integrating with Test Runners

This extension provides **editor features for TAP files** - it does not run tests itself. To use it with your test framework:

1. Configure your test runner to output TAP format to a `.tap` file
2. Open the generated `.tap` file in VS Code to view results with syntax highlighting

**Examples:**

```bash
# Node.js with tape
tape tests/*.js > results.tap

# Perl with prove
prove -v tests/ > results.tap

# Python with pytest-tap
pytest --tap-files

# PHP with PHPUnit
phpunit --log-tap results.tap

# MySQL with mytap
mysql -u root < tests.sql > results.tap
```

### TAP Format Reference

TAP files follow this structure:

```tap
TAP version 13
1..4
ok 1 - Input file opened
not ok 2 - First line valid
ok 3 - Read the rest of the file
ok 4 - Summarized correctly # TODO Not written yet
```

## Features

- [x] Syntax highlighting
- [x] Test suites folding
- [x] Test Explorer integration with pass/fail/skip status

## Requirements

- Visual Studio Code v1.59.0 or higher
