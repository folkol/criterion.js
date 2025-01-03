export function fibonacciRecursive(n) {
    if (n < 2) {
        return 1;
    }
    return fibonacciRecursive(n - 2) + fibonacciRecursive(n - 1);
}

export async function fibonacciAsync(n) {
    let a = await n
    let b = 1;
    while (n > 1) {
        let tmp = a + b;
        a = b;
        b = tmp;
        n -= 1;
    }
    return b;
}

export function fibonacciIterative(n) {
    let a = 1;
    let b = 1;
    while (n > 1) {
        let tmp = a + b;
        a = b;
        b = tmp;
        n -= 1;
    }
    return b;
}

export function addReduce(xs) {
    return xs.reduce((acc, x) => acc + x);
}

export function addOldSchool(xs) {
    let result = 0;
    for (let i = 0; i < xs.length; i++) {
        result += xs[i];
    }
    return result;
}

export function addNewSchool(xs) {
    let result = 0;
    for (let x of xs) {
        result += x;
    }
    return result;
}
