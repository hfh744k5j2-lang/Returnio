"""Pomocník pro vývoj: přidá klíče do messages/{cs,en}.json. Použití: python3 scripts/add-messages.py soubor.json
Vstup: {"klic.cesta": ["česky", "english"], ...}"""
import json, sys
new = json.load(open(sys.argv[1]))
for i, lang in enumerate(["cs", "en"]):
    path = f"messages/{lang}.json"
    d = json.load(open(path))
    for key, vals in new.items():
        cur = d
        parts = key.split(".")
        for p in parts[:-1]:
            cur = cur.setdefault(p, {})
        cur[parts[-1]] = vals[i]
    json.dump(d, open(path, "w"), ensure_ascii=False, indent=2)
    open(path, "a").write("\n")
