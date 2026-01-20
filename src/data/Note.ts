export class Note {
	public id: number;
	public user_id: string;
	public author_id: string;
	public body: string;
	public created_at: Date;

	constructor(props: {
		id?: number;
		user_id: string;
		author_id: string;
		body: string;
		created_at?: Date;
	}) {
		this.id = props.id || 0;
		this.user_id = props.user_id;
		this.author_id = props.author_id;
		this.body = props.body;
		this.created_at = props.created_at || new Date();
	}
}
