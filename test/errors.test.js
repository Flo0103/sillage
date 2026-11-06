import {test} from 'node:test';
import assert from 'node:assert/strict';
import {errorResponse} from '../server/errors.js';

const pg=(code,message='erreur PostgreSQL')=>Object.assign(Error(message),{code,severity:'ERROR'});

test('erreurs prévues : message utilisateur et statut choisi conservés',()=>{
 assert.deepEqual(errorResponse(Error('Coordonnées invalides.')),{status:400,message:'Coordonnées invalides.'});
 assert.deepEqual(errorResponse(Object.assign(Error('Ajoutez un point de passage.'),{code:'LOCAL_TOO_LARGE',status:422})),{status:422,message:'Ajoutez un point de passage.'});
 assert.equal(errorResponse(Object.assign(Error('Quota'),{status:429,retryAfter:1})).status,429);
});

test('PostgreSQL : contrainte en 409, base indisponible en 503, détail jamais renvoyé',()=>{
 const duplicate=errorResponse(pg('23505','duplicate key value violates unique constraint "users_username_key"'));
 assert.equal(duplicate.status,409);assert.ok(!duplicate.message.includes('users_username_key'));
 assert.equal(errorResponse(pg('40P01')).status,409);
 assert.equal(errorResponse(pg('57014')).status,503);
 assert.equal(errorResponse(pg('57P01')).status,503);
 assert.equal(errorResponse(pg('08006')).status,503);
 assert.equal(errorResponse(pg('22P02')).status,400);
 const unknown=errorResponse(pg('42P01','relation "x" does not exist'));assert.equal(unknown.status,500);assert.equal(unknown.log,true);assert.ok(!unknown.message.includes('relation'));
 // Pool exhausted beyond connectionTimeoutMillis.
 assert.equal(errorResponse(Error('timeout exceeded when trying to connect')).status,503);
 // Node's EPIPE also has five capital letters but is not a PostgreSQL code.
 assert.equal(errorResponse(Object.assign(Error('write EPIPE'),{code:'EPIPE'})).status,503);
});

test('réseau, délai et bugs',()=>{
 assert.equal(errorResponse(new TypeError('fetch failed')).status,503);
 assert.equal(errorResponse(Object.assign(Error('socket'),{code:'UND_ERR_SOCKET'})).status,503);
 assert.equal(errorResponse(new DOMException('timeout','TimeoutError')).status,504);
 assert.equal(errorResponse(new DOMException('aborted','AbortError')).status,503);
 for(const bug of [new TypeError('Cannot read properties of null (reading \'x\')'),new ReferenceError('x is not defined'),new RangeError('Invalid array length')]){
  const answer=errorResponse(bug);assert.equal(answer.status,500);assert.equal(answer.log,true);assert.ok(!answer.message.includes(bug.message));
 }
 assert.equal(errorResponse(null).status,500);
});
