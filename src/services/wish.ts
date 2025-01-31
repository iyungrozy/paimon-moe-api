import dayjs from 'dayjs';
import { getRepository, MoreThan } from 'typeorm';
import { Banner } from '../entities/banner';
import { Pull } from '../entities/pull';
import { Wish } from '../entities/wish';

export interface WishTallyResult {
  time: string;
  list: Array<{
    name: string;
    type: string;
    count: number;
    guaranteed: number;
  }>;
  pityAverage: {
    legendary: number;
    rare: number;
  };
  pityCount: {
    legendary: number[];
    rare: number[];
  };
}

export async function calculateWishTally(id: number): Promise<WishTallyResult> {
  const time = dayjs().format();

  console.log(JSON.stringify({ message: 'generating wish tally', banner: id, time }));

  const bannerRepo = getRepository(Banner);

  let banner;
  try {
    banner = await bannerRepo.findOneOrFail({ id });
  } catch (error) {
    throw new Error('invalid banner');
  }

  const pullRepo = getRepository(Pull);

  const legendaryPity: number[] = new Array(101).fill(0);
  const legendaryPityResult = await pullRepo
    .createQueryBuilder('pull')
    .select(['pity', 'COUNT(*) count'])
    .where({ banner })
    .andWhere('rarity = 5')
    .groupBy('pity')
    .getRawMany<{
    pity: number;
    count: string;
  }>();

  legendaryPityResult.forEach(e => {
    legendaryPity[e.pity] = Number(e.count);
  });

  const legendaryResult = await pullRepo
    .createQueryBuilder('pull')
    .select(['name', 'type', 'guaranteed', 'COUNT(*) count'])
    .groupBy('name')
    .addGroupBy('type')
    .addGroupBy('guaranteed')
    .where({ banner })
    .getRawMany<{
    name: string;
    type: string;
    guaranteed: boolean;
    count: string;
  }>();
  const _legendaryResult: {
    [key: string]: {
      name: string;
      type: string;
      guaranteed: number;
      count: number;
    };
  } = {};
  for (const e of legendaryResult) {
    if (_legendaryResult[e.name] === undefined) {
      _legendaryResult[e.name] = {
        name: '',
        type: '',
        guaranteed: 0,
        count: 0,
      };
    }

    _legendaryResult[e.name] = {
      name: e.name,
      type: e.type,
      count: _legendaryResult[e.name].count + Number(e.count),
      guaranteed: e.guaranteed ? Number(e.count) : _legendaryResult[e.name].guaranteed,
    };
  }
  const legendaryItems = Object.entries(_legendaryResult).map(e => e[1]);

  const legendaryPityAverage = await pullRepo
    .createQueryBuilder('pull')
    .select(['AVG(pity) avg', 'percentile_disc(0.5) WITHIN GROUP (ORDER BY pity) median'])
    .where({ banner })
    .andWhere('rarity = 5')
    .getRawOne<{ avg: string; median: string }>();

  const wishRepo = getRepository(Wish);
  const countPity = [...new Array(10)].map((e, i) => `SUM("rarePity"[${i + 1}]) p${i + 1}`);
  const rarePityResult = await wishRepo
    .createQueryBuilder('wish')
    .select(countPity)
    .where({ banner })
    .getRawOne<{
    p1: number;
    p2: number;
    p3: number;
    p4: number;
    p5: number;
    p6: number;
    p7: number;
    p8: number;
    p9: number;
    p10: number;
  }>();
  const rarePity = Object.entries(rarePityResult).map(([_, val]) => Number(val));
  const rarePityAverage = rarePity.reduce((prev, cur, index) => {
    prev.total += (index + 1) * cur;
    prev.count += cur;
    return prev;
  }, {
    total: 0,
    count: 0,
  });

  const totalPull = await wishRepo
    .createQueryBuilder('wish')
    .select(['SUM(total) sum', 'COUNT(*) count'])
    .where({ banner })
    .getRawOne<{ sum: null | string; count: null | string }>();

  // new pity total banner >= 300012 and banner >= 400011
  let countEachPity: number[] = [];
  if ((id >= 300012 && id < 400000) || id >= 400011 || id === 200001) {
    const invalidPulls = await pullRepo.find({
      where: {
        pity: MoreThan(90),
        banner,
      },
      relations: ['wish'],
    });

    for (const pull of invalidPulls) {
      await wishRepo.delete(pull.wish);
    }

    const pityCountTotal = [...new Array(90)].map((e, i) => `SUM("pityCount"[${i + 1}]) p${i + 1}`);
    const pityCountResult = await wishRepo
      .createQueryBuilder('wish')
      .select(pityCountTotal)
      .where({ banner })
      .andWhere('legendary > 0')
      .getRawOne<{[key: string]: number}>();
    countEachPity = Object.entries(pityCountResult).map(([_, val]) => Number(val));
  }

  const result = {
    time,
    list: legendaryItems,
    pityAverage: {
      legendary: Number(legendaryPityAverage.avg),
      rare: rarePityAverage.count > 0 ? rarePityAverage.total / rarePityAverage.count : 0,
    },
    median: {
      legendary: Number(legendaryPityAverage.median),
    },
    pityCount: {
      legendary: legendaryPity,
      rare: rarePity,
    },
    total: {
      legendary: legendaryPity.reduce((prev, cur) => (prev + cur), 0),
      rare: rarePity.reduce((prev, cur) => (prev + cur), 0),
      all: totalPull.sum === null ? 0 : Number(totalPull.sum),
      users: totalPull.count === null ? 0 : Number(totalPull.count),
    },
    countEachPity,
  };

  return result;
}
