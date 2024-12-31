export function fibonacciSlow(n) {
    if (n < 2) {
        return 1;
    }
    return fibonacciSlow(n - 2) + fibonacciSlow(n - 1);
}

export async function fibonacciFast(n) {
    let a = await Promise.resolve(1)
    let b = 1;
    while (n > 1) {
        let tmp = a + b;
        a = b;
        b = tmp;
        n -= 1;
    }
    return b;
}

export function fibonacciFast2(n) {
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
