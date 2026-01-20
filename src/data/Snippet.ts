export class Snippet {
	public trigger: string;
	public body: string;
	public created_by: string;
	public created_at: Date;

	constructor(props: {
		trigger: string;
		body: string;
		created_by: string;
		created_at: Date;
	}) {
		this.trigger = props.trigger;
		this.body = props.body;
		this.created_by = props.created_by;
		this.created_at = props.created_at;
	}
}
