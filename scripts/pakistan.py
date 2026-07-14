import glob
import os

# for file in glob.glob('pakistan_census/processed_forms/*/*/table_11.csv'):
#     p = file.split('/')
#     province, district = p[-2], p[-1]
#     os.rename(file, f'data/pakistan/{province}_{district}.csv')

import csv
from tqdm import tqdm

with open('data/pakistan/pakistan.csv', 'w') as fout:
    writer = csv.writer(fout)
    for file in tqdm(glob.glob('data/pakistan/*.csv')):
        if file == 'data/pakistan/pakistan.csv': continue
        with open(file, 'r') as fin:
            reader = csv.reader(fin)
            next(reader)
            for row in reader:
                writer.writerow(row)
