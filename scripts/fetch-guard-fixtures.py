#!/usr/bin/env python3
"""Fetch pinned mainnet executables for local runtime tests; never update pins."""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import struct
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / 'protocol/tests/fixtures/programs'
LOADER = 'BPFLoaderUpgradeab1e11111111111111111111111'
GENESIS = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d'
ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'


def pubkey(value):
    number = 0
    for char in value:
        number = number * 58 + ALPHABET.index(char)
    return b'\0' * (len(value) - len(value.lstrip('1'))) + number.to_bytes((number.bit_length() + 7) // 8, 'big')


def verify(data, metadata):
    if (len(data) != metadata['bytes'] or not data.startswith(b'\x7fELF')
            or hashlib.sha256(data).hexdigest() != metadata['sha256']):
        raise ValueError('Executable does not match pinned size, ELF magic and SHA-256')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', help='Verify local fixtures without network access')
    args = parser.parse_args()
    endpoint = os.environ.get('SENRO_RPC_URL', 'https://api.mainnet-beta.solana.com')
    url = urllib.parse.urlsplit(endpoint)
    if url.scheme != 'https' or not url.hostname or url.username or url.password or url.fragment:
        raise ValueError('SENRO_RPC_URL must be HTTPS without basic credentials or fragments')

    def rpc(method, params):
        body = json.dumps({'jsonrpc': '2.0', 'id': 1, 'method': method, 'params': params}).encode()
        request = urllib.request.Request(endpoint, body, {'Content-Type': 'application/json'})
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                result = json.load(response)
        except Exception:
            raise RuntimeError('RPC request failed; check endpoint availability and credentials privately') from None
        if 'error' in result or 'result' not in result:
            raise RuntimeError('RPC returned an error or missing result')
        return result['result']

    def account(address):
        result = rpc('getAccountInfo', [address, {'encoding': 'base64', 'commitment': 'finalized'}])['value']
        if result is None or result['owner'] != LOADER:
            raise ValueError('Missing account or unexpected loader owner')
        return result, base64.b64decode(result['data'][0], validate=True)

    checked_chain = False
    for name in ('pump_amm', 'pump_fees'):
        metadata = json.loads((FIXTURES / f'{name}.json').read_text())
        target = FIXTURES / f'{name}.so'
        if target.exists():
            verify(target.read_bytes(), metadata)
            print(f'{name}: verified local fixture')
            continue
        if args.check:
            raise ValueError(f'{name}: fixture missing; run python3 scripts/fetch-guard-fixtures.py')
        if not checked_chain:
            if rpc('getGenesisHash', []) != GENESIS:
                raise ValueError('RPC is not Solana mainnet')
            checked_chain = True
        program, data = account(metadata['program'])
        if not program['executable'] or len(data) != 36 or struct.unpack_from('<I', data)[0] != 2 or data[4:] != pubkey(metadata['programdata']):
            raise ValueError('Unexpected program or programdata pointer')
        _, data = account(metadata['programdata'])
        if len(data) < 45 or struct.unpack_from('<I', data)[0] != 3:
            raise ValueError('Unexpected programdata state')
        executable = data[45:]
        verify(executable, metadata)
        temporary = target.with_suffix('.so.tmp')
        temporary.write_bytes(executable)
        temporary.replace(target)
        print(f'{name}: fetched and verified pinned executable')


if __name__ == '__main__':
    main()
