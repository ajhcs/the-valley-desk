"""Print invented contract fixtures for local acceptance and load tests."""
import argparse
import json

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--count", type=int, default=4)
parser.add_argument("--institutions", action="store_true")
args = parser.parse_args()
ref = dict(id="fixture-institute", name="Fictional Estuary Research Institute", aliases=[],
           parent=None, kind="research institute", ror=None, homepage="https://example.org",
           outside=True, sites=[dict(name="Estuary campus", place="Camden", county="Camden",
                                     state="NJ", source="https://example.org/site")])
if args.institutions:
    print(json.dumps(ref))
else:
    for i in range(args.count):
        doi = "10.9999/fixture/a(b);%2f?x#y" if i == 0 else f"10.9999/fixture/{i}" if i >= 3 else None
        pid = f"doi:{doi}" if doi else "pmid:990000001" if i == 1 else "arxiv:9901.00002"
        n = 400 if i == 0 else 2
        members = [*range(1,11),230,400] if n == 400 else [1,2]
        r = dict(id=pid, title=["Imaging <em>methods</em> for tissue maps","Regional imaging atlas",
                                "An imaging atlas preprint","Retracted tissue study"][i%4] + f" {i}",
                 type="preprint" if i==2 else "article", published=["2026-10","2026","2026-10-12"][i%3],
                 venue="Estuary Methods", doi=doi, pmid="990000001" if i==1 else None, pmcid=None,
                 arxiv="9901.00002" if i==2 else None, url="https://example.org/work/"+str(i),
                 authors=[dict(name=f"Invented Byline {j}",orcid=None,regional=j in (1,230)) for j in members],
                 author_count=n,institutions=[ref["id"]],counties=["Camden"] if i%2==0 else [],
                 topic="Medical imaging",terms=["tomography" if i%31==0 else "tissue"],label="Verified" if i%2==0 else "Listed",
                 connection="The fixture affiliation names the Estuary campus in Camden." if i%2==0 else "The fixture index assigns the institute without a site.",
                 source="https://example.org/metadata/"+str(i),open_access=None,projects=["617168725"] if i==0 else [],
                 published_as="pmid:990000001" if i==2 else None,preprint_of=None,retracted=i==3,
                 added="2026-11-19",checked="2026-11-19")
        print(json.dumps(r))
