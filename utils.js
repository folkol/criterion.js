export function slugify(s) {
    return s.replaceAll(/\W/g, '_')
}
