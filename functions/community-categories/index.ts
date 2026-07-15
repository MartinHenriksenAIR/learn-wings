import { query } from '../shared/db';
import { endpoint } from '../shared/endpoint';

export default endpoint('community-categories', async ({ reply }) => {
    const categories = await query(`SELECT * FROM community_categories ORDER BY sort_order`, []);
    return reply(200, { categories });
});
