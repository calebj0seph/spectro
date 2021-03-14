const restrictedGlobals = require('eslint-restricted-globals');

module.exports = {
    rules: {
        'no-restricted-globals': ['error', 'isFinite', 'isNaN']
            .concat(restrictedGlobals)
            .filter((global) => global !== 'self'),
    },
};
