import json
from tqdm import tqdm

data = None
with open('india-5.json', 'r') as fin:
    data = json.load(fin)

for i, feature in enumerate(tqdm(data['features'])):
    try:
        code = int(feature['properties']['sdtcode11'])
        if code > 2077 and code <= 2143:
            feature['properties'] = data['features'][i + 1]['properties']
    except:
        print(feature['properties'])


# def change_district(x, y, state):
#     for feature in data['features']:
#         if feature['properties']['name_2'] == x and feature['properties']['name_1'] == state:
#             print(feature['properties']['name_3'], feature['properties']['name_2'], feature['properties']['name_1'],
#                 '->', feature['properties']['name_3'], y, feature['properties']['name_1'])
#             if input() == 'y':
#                 feature['properties']['name_2'] = y
#     return data


# def modify(x, y, state, district=None):
#     for feature in data['features']:
#         if feature['properties']['name_1'] == state and x in feature['properties']['name_3']:
#             print(feature['properties']['name_3'], feature['properties']['name_2'], feature['properties']['name_1'],
#                 '->', y, district or feature['properties']['name_2'], feature['properties']['name_1'])
#             if input() == 'y':
#                 if district:
#                     feature['properties']['name_2'] = district
#                 feature['properties']['name_3'] = y
#     return data
    
with open('india-5-fixed.geojson', 'w') as fout:
    json.dump(data, fout)