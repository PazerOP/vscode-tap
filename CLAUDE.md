# CLAUDE.md

This file provides guidance for Claude when working with this repository.

## Project Overview

vscode-tap is a Visual Studio Code extension that provides language support for Test Anything Protocol (TAP) files. It offers syntax highlighting, test suite folding, and comment support for `.tap` files.

## Commands

```bash
# Install dependencies
npm install

# Run grammar tests
npm test
```

## Project Structure

- `syntaxes/tap.tmLanguage.json` - TextMate grammar defining TAP syntax highlighting rules
- `language-configuration.json` - Language behavior configuration (comments, folding)
- `package.json` - Extension manifest and metadata
- `test/syntax/*.tap` - Grammar test files with inline assertions
- `out/extension.js` - Compiled extension entry point (minimal, declarative extension)

## Key Patterns

- This is a declarative VS Code extension - most functionality is defined via JSON configuration, not JavaScript code
- Grammar tests use vscode-tmgrammar-test with annotated comments in `.tap` files to verify tokenization
- TAP syntax includes: version declarations (`TAP version 13`), test plans (`1..N`), results (`ok`/`not ok`), comments (`#`), and embedded YAML blocks

## Development Notes

- Extension targets VS Code v1.17.0+
- Published to VS Code Marketplace under publisher "numaru"
- CI validates JSON syntax and runs grammar tests on Node.js 20
