import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {slugify} from "./utils.js";

describe('slugify', () => {
    it('should replace weird stuff with underscores', () => {
        assert.equal(slugify('hello'), 'hello')
        assert.equal(slugify('h.e.l.l.o'), 'h_e_l_l_o')
        assert.equal(slugify('h/e/l/l/o'), 'h_e_l_l_o')
        assert.equal(slugify('H̵̻̫̘̟̖̽̌͒e̴̮̩̘̙͎̞̟̟̭̜̖͇̥͑̇̈̉́͑̍͋͊̇́̀̓͜͝͝l̸̫̀̄̑̃̃͐̈̑̃͒͒̔̇͆̋̍͠ͅl̴̨̨̡̧̫̱̘͇͍̽͒o̷͕̫͓̝̞̠͉̅͛̽͊͗̐'), 'H_________e______________________________l____________________l____________o______________')
    })
})
